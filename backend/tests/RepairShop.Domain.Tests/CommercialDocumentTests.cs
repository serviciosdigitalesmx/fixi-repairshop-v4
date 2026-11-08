using FluentAssertions;
using RepairShop.Domain.Common;
using RepairShop.Domain.CommercialDocuments;
using RepairShop.Domain.RepairOrders;

namespace RepairShop.Domain.Tests;

public sealed class CommercialDocumentTests
{
    private static readonly DateTime Now = new(2026, 11, 7, 18, 30, 0, DateTimeKind.Utc);
    private static readonly Guid ShopId = Guid.NewGuid();
    private static readonly Guid UserId = Guid.NewGuid();
    private static readonly CommercialPartySnapshot Issuer = new("Fixi Taller", "Fixi Taller SA de CV", Address: "Av. Central 123", City: "Puebla", Country: "MX");

    [Fact]
    public void Commercial_document_normalizes_mxn_and_snapshots_lines_and_discount()
    {
        var document = Create(
            lines: new[]
            {
                new CommercialDocumentLineInput("Pantalla", 2, 100, DiscountAmount: 10, Sku: "SCR-1"),
                new CommercialDocumentLineInput("Mano de obra", 1, 60)
            },
            currency: " mxn ",
            discountAmount: 20,
            operationTotal: 230);

        document.Currency.Should().Be("MXN");
        document.Subtotal.Should().Be(250);
        document.DiscountAmount.Should().Be(20);
        document.Total.Should().Be(230);
        document.Lines.Select(x => x.Position).Should().Equal(1, 2);
        document.Lines.Select(x => x.Total).Should().Equal(190, 60);
        document.Lines[0].Sku.Should().Be("SCR-1");
    }

    [Fact]
    public void Commercial_document_rejects_currency_outside_mxn()
    {
        var act = () => Create(currency: "ARS");

        act.Should().Throw<DomainException>().WithMessage("*solo se emiten en MXN*");
    }

    [Fact]
    public void Commercial_document_rejects_lines_that_do_not_reconcile_with_operation_total()
    {
        var act = () => Create(
            lines: new[] { new CommercialDocumentLineInput("Servicio", 1, 100) },
            operationTotal: 99.99m);

        act.Should().Throw<DomainException>()
            .WithMessage("Los conceptos suman 100.00 MXN, el descuento global es 0.00 MXN y el total calculado es 100.00 MXN; la operación registra 99.99 MXN.");
    }

    [Fact]
    public void Commercial_document_rejects_line_discount_above_gross_amount()
    {
        var act = () => Create(lines: new[] { new CommercialDocumentLineInput("Refacción", 2, 50, DiscountAmount: 100.01m) });

        act.Should().Throw<DomainException>().WithMessage("*descuento del concepto supera*");
    }

    [Fact]
    public void Commercial_document_rejects_global_discount_above_subtotal()
    {
        var act = () => Create(discountAmount: 100.01m, operationTotal: 0);

        act.Should().Throw<DomainException>().WithMessage("*descuento global no puede superar*");
    }

    [Fact]
    public void Commercial_document_rejects_empty_or_invalid_concepts()
    {
        var noLines = () => Create(lines: Array.Empty<CommercialDocumentLineInput>());
        var noDescription = () => Create(lines: new[] { new CommercialDocumentLineInput(" ", 1, 10) });
        var zeroQuantity = () => Create(lines: new[] { new CommercialDocumentLineInput("Servicio", 0, 10) });
        var negativePrice = () => Create(lines: new[] { new CommercialDocumentLineInput("Servicio", 1, -1) });

        noLines.Should().Throw<DomainException>().WithMessage("*al menos un concepto*");
        noDescription.Should().Throw<DomainException>().WithMessage("*descripción*");
        zeroQuantity.Should().Throw<DomainException>().WithMessage("*cantidad*mayor a 0*");
        negativePrice.Should().Throw<DomainException>().WithMessage("*precio unitario no puede ser negativo*");
    }

    [Fact]
    public void Commercial_document_computes_paid_and_balance_from_payment_refund_and_change_snapshots()
    {
        var document = Create(
            operationTotal: 230,
            payments: new[]
            {
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, PaymentMethod.Cash, 150),
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, PaymentMethod.Card, 50),
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, PaymentMethod.Transfer, 40, IsDeposit: true),
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Refund, PaymentMethod.Cash, 30)
            },
            changeAmount: 20);

        document.PaidAtIssue.Should().Be(190);
        document.DepositAmountAtIssue.Should().Be(40);
        document.PaymentsAtIssue.Should().Be(150);
        document.BalanceAtIssue.Should().Be(40);
        document.Payments.Select(x => x.Type).Should().Contain(CommercialPaymentMovementType.Refund);
        document.Payments.Single(x => x.IsDeposit).Amount.Should().Be(40);
    }

    [Fact]
    public void Commercial_document_allows_saldo_a_favor_without_changing_operation_total()
    {
        var document = Create(
            operationTotal: 100,
            payments: new[] { new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, PaymentMethod.Transfer, 120) });

        document.Total.Should().Be(100);
        document.PaidAtIssue.Should().Be(120);
        document.BalanceAtIssue.Should().Be(-20);
    }

    [Fact]
    public void Commercial_document_rejects_invalid_payment_and_deposit_reconciliation()
    {
        var excessiveChange = () => Create(
            payments: new[] { new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, PaymentMethod.Card, 100) },
            changeAmount: 1);
        var excessiveRefund = () => Create(
            payments: new[]
            {
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, PaymentMethod.Cash, 100),
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Refund, PaymentMethod.Cash, 101)
            });
        var refundConsumesChange = () => Create(
            payments: new[]
            {
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, PaymentMethod.Cash, 110),
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Refund, PaymentMethod.Cash, 105)
            },
            changeAmount: 10);
        var refundExceedsRegularPayments = () => Create(
            payments: new[]
            {
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, PaymentMethod.Transfer, 100, IsDeposit: true),
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, PaymentMethod.Card, 60),
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Refund, PaymentMethod.Card, 61)
            });
        var refundExceedsDeposits = () => Create(
            payments: new[]
            {
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, PaymentMethod.Transfer, 40, IsDeposit: true),
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Refund, PaymentMethod.Transfer, 41, IsDeposit: true)
            });

        excessiveChange.Should().Throw<DomainException>().WithMessage("*cambio no puede superar el efectivo recibido*");
        excessiveRefund.Should().Throw<DomainException>().WithMessage("*devoluciones registradas superan los pagos recibidos*");
        refundConsumesChange.Should().Throw<DomainException>().WithMessage("*pagos netos después del cambio*");
        refundExceedsRegularPayments.Should().Throw<DomainException>().WithMessage("*devoluciones de pagos superan los pagos netos recibidos*");
        refundExceedsDeposits.Should().Throw<DomainException>().WithMessage("*devoluciones de anticipos superan los anticipos recibidos*");
    }

    [Fact]
    public void Refund_of_deposit_reduces_advance_snapshot_separately()
    {
        var document = Create(
            payments: new[]
            {
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, PaymentMethod.Transfer, 40, IsDeposit: true),
                new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Refund, PaymentMethod.Transfer, 10, IsDeposit: true)
            });

        document.DepositAmountAtIssue.Should().Be(30);
        document.PaymentsAtIssue.Should().Be(0);
        document.PaidAtIssue.Should().Be(30);
    }

    [Fact]
    public void Administrative_cancellation_preserves_historical_amounts_and_snapshots()
    {
        var document = Create(
            lines: new[] { new CommercialDocumentLineInput("Reparación", 1, 100) },
            payments: new[] { new CommercialDocumentPaymentInput(CommercialPaymentMovementType.Payment, PaymentMethod.Cash, 25) });
        var originalLine = document.Lines.Single();
        var originalPayment = document.Payments.Single();
        var issuedTotal = document.Total;
        var paidAtIssue = document.PaidAtIssue;
        var balanceAtIssue = document.BalanceAtIssue;

        document.Cancel("Captura duplicada", UserId, Now.AddMinutes(5));

        document.Status.Should().Be(CommercialDocumentStatus.Cancelled);
        document.CancellationReason.Should().Be("Captura duplicada");
        document.CancelledByUserId.Should().Be(UserId);
        document.CancelledAtUtc.Should().Be(Now.AddMinutes(5));
        document.Total.Should().Be(issuedTotal);
        document.PaidAtIssue.Should().Be(paidAtIssue);
        document.BalanceAtIssue.Should().Be(balanceAtIssue);
        document.Lines.Single().Should().BeSameAs(originalLine);
        document.Lines.Single().Total.Should().Be(100);
        document.Payments.Single().Should().BeSameAs(originalPayment);
        document.Payments.Single().Type.Should().Be(CommercialPaymentMovementType.Payment);
    }

    [Fact]
    public void Cancellation_requires_reason_and_responsible_user_and_cannot_repeat()
    {
        var document = Create();

        var noReason = () => document.Cancel(" ", UserId, Now);
        var noUser = () => document.Cancel("Error de captura", Guid.Empty, Now);
        noReason.Should().Throw<DomainException>().WithMessage("*motivo de cancelación*");
        noUser.Should().Throw<DomainException>().WithMessage("*usuario responsable*");

        document.Cancel("Error de captura", UserId, Now);
        var repeated = () => document.Cancel("Segundo intento", UserId, Now.AddMinutes(1));

        repeated.Should().Throw<DomainException>().WithMessage("*documento comercial vigente*");
    }

    [Fact]
    public void Commercial_document_requires_shop_source_number_and_issuer()
    {
        var emptyShop = () => new CommercialDocument(Guid.Empty, CommercialDocumentSourceType.Sale, Guid.NewGuid(), 1, "MXN", Issuer, null,
            new[] { new CommercialDocumentLineInput("Servicio", 1, 1) }, 0, Array.Empty<CommercialDocumentPaymentInput>(), 0, 1, UserId, Now);
        var emptySource = () => new CommercialDocument(ShopId, CommercialDocumentSourceType.Sale, Guid.Empty, 1, "MXN", Issuer, null,
            new[] { new CommercialDocumentLineInput("Servicio", 1, 1) }, 0, Array.Empty<CommercialDocumentPaymentInput>(), 0, 1, UserId, Now);
        var invalidNumber = () => new CommercialDocument(ShopId, CommercialDocumentSourceType.Sale, Guid.NewGuid(), 0, "MXN", Issuer, null,
            new[] { new CommercialDocumentLineInput("Servicio", 1, 1) }, 0, Array.Empty<CommercialDocumentPaymentInput>(), 0, 1, UserId, Now);
        var missingIssuer = () => new CommercialDocument(ShopId, CommercialDocumentSourceType.Sale, Guid.NewGuid(), 1, "MXN", new CommercialPartySnapshot(" "), null,
            new[] { new CommercialDocumentLineInput("Servicio", 1, 1) }, 0, Array.Empty<CommercialDocumentPaymentInput>(), 0, 1, UserId, Now);

        emptyShop.Should().Throw<DomainException>().WithMessage("*sucursal*");
        emptySource.Should().Throw<DomainException>().WithMessage("*venta o una orden*");
        invalidNumber.Should().Throw<DomainException>().WithMessage("*folio comercial*");
        missingIssuer.Should().Throw<DomainException>().WithMessage("*emisor debe tener nombre*");
    }

    private static CommercialDocument Create(
        CommercialDocumentLineInput[]? lines = null,
        string currency = "MXN",
        decimal discountAmount = 0,
        CommercialDocumentPaymentInput[]? payments = null,
        decimal changeAmount = 0,
        decimal? operationTotal = null)
    {
        lines ??= new[] { new CommercialDocumentLineInput("Reparación", 1, 100) };
        var computed = lines.Sum(line => decimal.Round(
            decimal.Round(line.Quantity, 3, MidpointRounding.AwayFromZero) * Money.Round(line.UnitPrice), 2, MidpointRounding.AwayFromZero)
            - Money.Round(line.DiscountAmount)) - discountAmount;

        return new CommercialDocument(
            ShopId,
            CommercialDocumentSourceType.Sale,
            Guid.NewGuid(),
            number: 1,
            currency,
            Issuer,
            new CommercialPartySnapshot("Cliente de prueba"),
            lines,
            discountAmount,
            payments ?? Array.Empty<CommercialDocumentPaymentInput>(),
            changeAmount,
            operationTotal ?? computed,
            UserId,
            Now);
    }
}
