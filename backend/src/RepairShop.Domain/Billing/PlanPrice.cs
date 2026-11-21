using RepairShop.Domain.Common;

namespace RepairShop.Domain.Billing;

/// <summary>Owner-managed MXN catalog price. Existing provider contracts retain their historical amounts.</summary>
public sealed class PlanPrice
{
    public PlanId Plan { get; private set; }
    public decimal MonthlyPrice { get; private set; }
    public DateTime UpdatedAtUtc { get; private set; }
    private PlanPrice() { }
    public PlanPrice(PlanId plan, decimal monthlyPrice, DateTime nowUtc)
    {
        if (!Enum.IsDefined(plan)) throw new DomainException("Plan inválido.");
        Plan = plan;
        Update(monthlyPrice, nowUtc);
    }
    public void Update(decimal monthlyPrice, DateTime nowUtc)
    {
        if (monthlyPrice <= 0 || monthlyPrice > 1000000 || decimal.Round(monthlyPrice, 2) != monthlyPrice)
            throw new DomainException("El precio debe ser positivo, tener máximo dos decimales y no superar 1,000,000 MXN.");
        MonthlyPrice = monthlyPrice;
        UpdatedAtUtc = nowUtc;
    }
}
