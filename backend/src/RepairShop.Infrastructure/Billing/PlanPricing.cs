using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using RepairShop.Application.Abstractions;
using RepairShop.Application.Billing;
using RepairShop.Domain.Billing;
using RepairShop.Infrastructure.Persistence;
namespace RepairShop.Infrastructure.Billing;
public sealed class PlanPricing(RepairShopDbContext db, IOptions<BillingOptions> options) : IPlanPricing
{
    public async Task<decimal?> PriceAsync(PlanId plan, string currency, CancellationToken ct)
        => (currency == "MXN" ? await db.PlanPrices.AsNoTracking().Where(p => p.Plan == plan)
            .Select(p => (decimal?)p.MonthlyPrice).FirstOrDefaultAsync(ct) : null) ?? options.Value.PriceFor(plan, currency);
}
