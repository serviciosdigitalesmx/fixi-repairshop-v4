using RepairShop.Domain.Common;
using RepairShop.Domain.RepairOrders;

namespace RepairShop.Domain.CommercialDocuments;

public enum CommercialDocumentSourceType
{
    Sale = 1,
    RepairOrder = 2
}

public enum CommercialDocumentStatus
{
    Issued = 1,
    Cancelled = 2
}

public enum CommercialPaymentMovementType
{
    Payment = 1,
    Refund = 2
}

/// <summary>Contact data copied into a commercial document when it is issued.</summary>
public sealed record CommercialPartySnapshot(
    string Name,
    string? LegalName = null,
    string? Phone = null,
    string? Email = null,
    string? Address = null,
    string? City = null,
    string? Country = null);

public sealed record CommercialDocumentLineInput(
    string Description,
    decimal Quantity,
    decimal UnitPrice,
    decimal DiscountAmount = 0,
    string? Sku = null);

public sealed record CommercialDocumentPaymentInput(
    CommercialPaymentMovementType Type,
    PaymentMethod Method,
    decimal Amount,
    bool IsDeposit = false,
    string? Reference = null);

/// <summary>
/// Immutable snapshot of a Mexican-peso commercial operation. It has no fiscal authority,
/// tax, or electronic-invoice state. Cancellation records an administrative event without
/// changing the issued amounts or their snapshots.
/// </summary>
public sealed class CommercialDocument : IShopScoped
{
    private readonly List<CommercialDocumentLine> _lines = new();
    private readonly List<CommercialDocumentPayment> _payments = new();

    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid ShopId { get; private set; }
    public CommercialDocumentSourceType SourceType { get; private set; }
    public Guid SourceId { get; private set; }
    public int Number { get; private set; }
    public string Currency { get; private set; } = "MXN";
    public DateTime IssuedAtUtc { get; private set; }
    public CommercialDocumentStatus Status { get; private set; } = CommercialDocumentStatus.Issued;

    public CommercialPartySnapshot Issuer { get; private set; } = null!;
    public CommercialPartySnapshot? Recipient { get; private set; }

    public decimal Subtotal { get; private set; }
    public decimal DiscountAmount { get; private set; }
    public decimal Total { get; private set; }
    public decimal ChangeAmount { get; private set; }
    public decimal DepositAmountAtIssue { get; private set; }
    public decimal PaymentsAtIssue { get; private set; }
    public decimal PaidAtIssue { get; private set; }
    public decimal BalanceAtIssue { get; private set; }

    public Guid CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }
    public DateTime? CancelledAtUtc { get; private set; }
    public Guid? CancelledByUserId { get; private set; }
    public string? CancellationReason { get; private set; }

    public IReadOnlyList<CommercialDocumentLine> Lines => _lines.AsReadOnly();
    public IReadOnlyList<CommercialDocumentPayment> Payments => _payments.AsReadOnly();

    private CommercialDocument() { }

    public CommercialDocument(
        Guid shopId,
        CommercialDocumentSourceType sourceType,
        Guid sourceId,
        int number,
        string currency,
        CommercialPartySnapshot issuer,
        CommercialPartySnapshot? recipient,
        IEnumerable<CommercialDocumentLineInput> lines,
        decimal discountAmount,
        IEnumerable<CommercialDocumentPaymentInput> payments,
        decimal changeAmount,
        decimal operationTotal,
        Guid createdByUserId,
        DateTime nowUtc)
    {
        if (shopId == Guid.Empty) throw new DomainException("El documento debe pertenecer a una sucursal.");
        if (!Enum.IsDefined(sourceType)) throw new DomainException("El origen del documento no es válido.");
        if (sourceId == Guid.Empty) throw new DomainException("El documento debe referenciar una venta o una orden.");
        if (number <= 0) throw new DomainException("El folio comercial debe ser mayor a 0.");
        if (createdByUserId == Guid.Empty) throw new DomainException("El documento debe tener un usuario emisor.");

        var normalizedCurrency = Money.NormalizeCurrency(currency);
        if (normalizedCurrency != "MXN") throw new DomainException("Los documentos comerciales solo se emiten en MXN.");

        ShopId = shopId;
        SourceType = sourceType;
        SourceId = sourceId;
        Number = number;
        Currency = normalizedCurrency;
        Issuer = NormalizeParty(issuer, "El emisor");
        Recipient = recipient is null ? null : NormalizeParty(recipient, "El cliente");
        CreatedByUserId = createdByUserId;
        CreatedAtUtc = nowUtc;
        IssuedAtUtc = nowUtc;
        UpdatedAtUtc = nowUtc;

        ArgumentNullException.ThrowIfNull(lines);
        var position = 1;
        foreach (var line in lines) _lines.Add(new CommercialDocumentLine(line, position++));
        if (_lines.Count == 0) throw new DomainException("El documento debe contener al menos un concepto.");

        Subtotal = Money.Round(_lines.Sum(line => line.Total));
        if (discountAmount < 0) throw new DomainException("El descuento global no puede ser negativo.");
        DiscountAmount = Money.Round(discountAmount);
        if (DiscountAmount > Subtotal) throw new DomainException("El descuento global no puede superar el subtotal.");

        Total = Money.Round(Subtotal - DiscountAmount);
        if (operationTotal < 0)
            throw new DomainException("El importe de la operación no puede ser negativo.");
        var reportedTotal = Money.Round(operationTotal);
        if (Total != reportedTotal)
            throw new DomainException($"Los conceptos suman {Subtotal:0.00} MXN, el descuento global es {DiscountAmount:0.00} MXN y el total calculado es {Total:0.00} MXN; la operación registra {reportedTotal:0.00} MXN.");

        ArgumentNullException.ThrowIfNull(payments);
        foreach (var payment in payments) _payments.Add(new CommercialDocumentPayment(payment));

        if (changeAmount < 0) throw new DomainException("El cambio no puede ser negativo.");
        ChangeAmount = Money.Round(changeAmount);

        var cashReceived = _payments
            .Where(payment => payment.Type == CommercialPaymentMovementType.Payment && !payment.IsDeposit && payment.Method == PaymentMethod.Cash)
            .Sum(payment => payment.Amount);
        if (ChangeAmount > cashReceived) throw new DomainException("El cambio no puede superar el efectivo recibido.");

        var received = _payments.Where(payment => payment.Type == CommercialPaymentMovementType.Payment).Sum(payment => payment.Amount);
        var returned = _payments.Where(payment => payment.Type == CommercialPaymentMovementType.Refund).Sum(payment => payment.Amount);
        if (returned > received) throw new DomainException("Las devoluciones registradas superan los pagos recibidos.");
        if (returned > received - ChangeAmount) throw new DomainException("Las devoluciones registradas superan los pagos netos después del cambio.");

        var depositsReceived = _payments.Where(payment => payment.Type == CommercialPaymentMovementType.Payment && payment.IsDeposit).Sum(payment => payment.Amount);
        var depositsReturned = _payments.Where(payment => payment.Type == CommercialPaymentMovementType.Refund && payment.IsDeposit).Sum(payment => payment.Amount);
        if (depositsReturned > depositsReceived) throw new DomainException("Las devoluciones de anticipos superan los anticipos recibidos.");
        var otherPaymentsReceived = received - depositsReceived;
        var otherPaymentsReturned = returned - depositsReturned;
        if (otherPaymentsReturned > otherPaymentsReceived - ChangeAmount)
            throw new DomainException("Las devoluciones de pagos superan los pagos netos recibidos.");

        PaidAtIssue = Money.Round(received - returned - ChangeAmount);
        DepositAmountAtIssue = Money.Round(depositsReceived - depositsReturned);
        PaymentsAtIssue = Money.Round(PaidAtIssue - DepositAmountAtIssue);
        BalanceAtIssue = Money.Round(Total - PaidAtIssue);
    }

    /// <summary>Administrative cancellation; keeps the issued commercial snapshot unchanged.</summary>
    public void Cancel(string reason, Guid userId, DateTime nowUtc)
    {
        if (Status != CommercialDocumentStatus.Issued)
            throw new DomainException("Solo se puede cancelar un documento comercial vigente.");
        if (string.IsNullOrWhiteSpace(reason)) throw new DomainException("Indicá el motivo de cancelación.");
        if (userId == Guid.Empty) throw new DomainException("La cancelación debe tener un usuario responsable.");

        Status = CommercialDocumentStatus.Cancelled;
        CancellationReason = reason.Trim();
        CancelledByUserId = userId;
        CancelledAtUtc = nowUtc;
        UpdatedAtUtc = nowUtc;
    }

    private static CommercialPartySnapshot NormalizeParty(CommercialPartySnapshot? party, string label)
    {
        if (party is null || string.IsNullOrWhiteSpace(party.Name))
            throw new DomainException($"{label} debe tener nombre.");

        static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

        return new CommercialPartySnapshot(
            party.Name.Trim(), Clean(party.LegalName), Clean(party.Phone), Clean(party.Email),
            Clean(party.Address), Clean(party.City), Clean(party.Country));
    }
}

public sealed class CommercialDocumentLine
{
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid CommercialDocumentId { get; private set; }
    public int Position { get; private set; }
    public string? Sku { get; private set; }
    public string Description { get; private set; } = null!;
    public decimal Quantity { get; private set; }
    public decimal UnitPrice { get; private set; }
    public decimal DiscountAmount { get; private set; }
    public decimal Total { get; private set; }

    private CommercialDocumentLine() { }

    internal CommercialDocumentLine(CommercialDocumentLineInput input, int position)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (position <= 0) throw new DomainException("La posición del concepto debe ser mayor a 0.");
        if (string.IsNullOrWhiteSpace(input.Description)) throw new DomainException("Cada concepto debe tener una descripción.");
        if (input.Quantity <= 0) throw new DomainException("La cantidad de cada concepto debe ser mayor a 0.");
        if (input.UnitPrice < 0) throw new DomainException("El precio unitario no puede ser negativo.");
        if (input.DiscountAmount < 0) throw new DomainException("El descuento del concepto no puede ser negativo.");

        Description = input.Description.Trim();
        Position = position;
        Sku = string.IsNullOrWhiteSpace(input.Sku) ? null : input.Sku.Trim();
        Quantity = decimal.Round(input.Quantity, 3, MidpointRounding.AwayFromZero);
        if (Quantity <= 0) throw new DomainException("La cantidad redondeada del concepto debe ser mayor a 0.");
        UnitPrice = Money.Round(input.UnitPrice);
        DiscountAmount = Money.Round(input.DiscountAmount);

        var gross = Money.Round(Quantity * UnitPrice);
        if (DiscountAmount > gross) throw new DomainException("El descuento del concepto supera su importe bruto.");
        Total = Money.Round(gross - DiscountAmount);
    }
}

public sealed class CommercialDocumentPayment
{
    public Guid Id { get; private set; } = Guid.NewGuid();
    public Guid CommercialDocumentId { get; private set; }
    public CommercialPaymentMovementType Type { get; private set; }
    public PaymentMethod Method { get; private set; }
    public decimal Amount { get; private set; }
    public bool IsDeposit { get; private set; }
    public string? Reference { get; private set; }

    private CommercialDocumentPayment() { }

    internal CommercialDocumentPayment(CommercialDocumentPaymentInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (!Enum.IsDefined(input.Type)) throw new DomainException("El tipo de movimiento de pago no es válido.");
        if (!Enum.IsDefined(input.Method)) throw new DomainException("El medio de pago no es válido.");
        if (input.Amount <= 0) throw new DomainException("El importe de cada pago o devolución debe ser mayor a 0.");
        Type = input.Type;
        Method = input.Method;
        Amount = Money.Round(input.Amount);
        if (Amount <= 0) throw new DomainException("El importe redondeado debe ser mayor a 0.");
        IsDeposit = input.IsDeposit;
        Reference = string.IsNullOrWhiteSpace(input.Reference) ? null : input.Reference.Trim();
    }
}
