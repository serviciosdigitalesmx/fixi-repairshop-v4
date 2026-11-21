using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RepairShop.Domain.Billing;
namespace RepairShop.Infrastructure.Persistence.Configurations;
internal sealed class PlanPriceConfiguration : IEntityTypeConfiguration<PlanPrice>
{
    public void Configure(EntityTypeBuilder<PlanPrice> b)
    {
        b.ToTable("platform_plan_prices");
        b.HasKey(x => x.Plan);
        b.Property(x => x.Plan).ValueGeneratedNever();
        b.Property(x => x.MonthlyPrice).HasPrecision(18, 2);
    }
}
