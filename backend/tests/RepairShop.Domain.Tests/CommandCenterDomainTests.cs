using FluentAssertions;
using RepairShop.Domain.Billing;
using RepairShop.Domain.Common;
using RepairShop.Domain.Users;

namespace RepairShop.Domain.Tests;
public sealed class CommandCenterDomainTests
{
    [Fact]
    public void Operational_activation_cannot_clear_platform_suspension()
    {
        var now = DateTime.UtcNow;
        var shop = new RepairShop.Domain.Shops.Shop("Shop", null, null, null, "MX", now);
        shop.IsPlatformSuspended.Should().BeFalse();
        shop.SetPlatformSuspended(true, now); shop.SetActive(false, now);
        var activate = () => shop.SetActive(true, now);
        activate.Should().Throw<DomainException>();
        var legacyActivate = () => shop.SetActive(true);
        legacyActivate.Should().Throw<DomainException>();
        shop.IsPlatformSuspended.Should().BeTrue(); shop.IsActive.Should().BeFalse();
        shop.SetPlatformSuspended(false, now); shop.SetActive(true, now); shop.IsActive.Should().BeTrue();
    }
    [Fact]
    public void Global_privilege_is_opt_in_and_rotates_the_security_stamp_on_grant_and_revoke()
    {
        var user = new AppUser(Guid.NewGuid(), "owner@example.test", "Owner", UserRole.Admin, new string('x', 32), DateTime.UtcNow);
        user.IsSuperAdmin.Should().BeFalse(); var stamp = user.SecurityStamp;
        user.SetSuperAdmin(true, DateTime.UtcNow); user.SecurityStamp.Should().NotBe(stamp); stamp = user.SecurityStamp;
        user.SetSuperAdmin(false, DateTime.UtcNow); user.SecurityStamp.Should().NotBe(stamp);
    }
    [Theory]
    [InlineData("-0.004")][InlineData("0")][InlineData("0.001")][InlineData("1.001")][InlineData("1000000.01")]
    public void Plan_prices_reject_invalid_original_amounts(string value)
    {
        var action = () => new PlanPrice(PlanId.Pro, decimal.Parse(value, System.Globalization.CultureInfo.InvariantCulture), DateTime.UtcNow);
        action.Should().Throw<DomainException>();
    }
    [Theory]
    [InlineData("0.01")][InlineData("600")][InlineData("600.50")][InlineData("1000000")]
    public void Plan_prices_preserve_valid_cent_amounts(string value)
    {
        var amount = decimal.Parse(value, System.Globalization.CultureInfo.InvariantCulture);
        new PlanPrice(PlanId.Pro, amount, DateTime.UtcNow).MonthlyPrice.Should().Be(amount);
    }
    [Fact]
    public void Restarting_local_trial_grants_exactly_fifteen_days_without_recording_income()
    {
        var now = new DateTime(2026, 11, 20, 0, 0, 0, DateTimeKind.Utc);
        var sub = Subscription.Complimentary(Guid.NewGuid(), PlanId.Basic, "MX", now);
        sub.RestartTrial(now); sub.TrialEndsAtUtc.Should().Be(now.AddDays(15)); sub.Plan.Should().Be(PlanId.Pro);
        sub.Amount.Should().BeNull(); sub.Currency.Should().BeNull(); sub.Provider.Should().Be(BillingProvider.None);
    }
    [Theory]
    [InlineData(BillingProvider.MercadoPago)][InlineData(BillingProvider.Paddle)]
    public void Provider_contracts_cannot_be_silently_overwritten_by_local_trial(BillingProvider provider)
    {
        var now = DateTime.UtcNow;
        var sub = Subscription.StartTrial(Guid.NewGuid(), "MX", 15, now);
        sub.ApplyProviderState(provider, "domain-contract-reference", PlanId.Pro, SubscriptionStatus.Active, now.AddMonths(1), 600m, "MXN", null, now, now);
        var action = () => sub.RestartTrial(now);
        action.Should().Throw<DomainException>();
        sub.Provider.Should().Be(provider); sub.Amount.Should().Be(600m);
    }
}
