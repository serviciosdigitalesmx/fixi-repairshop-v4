using RepairShop.Domain.Billing;
namespace RepairShop.Application.Abstractions;
public interface IPlanPricing
{
    Task<decimal?> PriceAsync(PlanId plan, string currency, CancellationToken ct);
}
