using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using RepairShop.Domain.Users;
using RepairShop.Infrastructure.Persistence;

namespace RepairShop.Api.IntegrationTests;

// Real HTTP authentication and disposable PostgreSQL. No replacement auth handler or in-memory repositories.
[Collection(ApiCollection.Name)]
public sealed class CommandCenterTests(ApiFactory factory)
{
    private async Task<(ApiClient Api, JsonElement Login)> Owner()
    {
        var (_, login) = await ApiClient.SignupAsync(factory, "MX");
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RepairShopDbContext>();
        var id = Guid.Parse(login.GetProperty("user").Str("id"));
        var user = await db.Users.SingleAsync(u => u.Id == id);
        user.MarkEmailVerified(DateTime.UtcNow);
        user.SetSuperAdmin(true, DateTime.UtcNow); // Explicit server-side grant, equivalent to offline bootstrap.
        await db.SaveChangesAsync();
        var api = await ApiClient.LoginAsync(factory, user.Email, "Clave12345");
        return (api, login);
    }
    private static string[] Reads => ["/admin/access", "/admin/dashboard", "/admin/shops", "/admin/users", "/admin/subscriptions", "/admin/plans", "/admin/audit"];

    [IntegrationFact]
    public async Task Anonymous_cannot_read_any_global_endpoint()
    {
        using var client = factory.CreateClient();
        foreach (var path in Reads) (await client.GetAsync("/api/v1" + path)).StatusCode.Should().Be(HttpStatusCode.Unauthorized, path);
    }

    [IntegrationFact]
    public async Task Every_tenant_role_is_denied_global_reads_and_writes()
    {
        var (admin, login) = await ApiClient.SignupAsync(factory, "MX");
        foreach (var role in Enum.GetValues<UserRole>())
        {
            var api = admin;
            if (role != UserRole.Admin)
            {
                var email = $"role-{Guid.NewGuid():N}@example.test";
                var invite = await (await admin.Post("/users", new { email, displayName = "Security coverage", role = role.ToString() })).DataAsync();
                var token = Uri.UnescapeDataString(invite.Str("url").Split("token=")[1]);
                var accepted = await (await factory.CreateClient().PostAsJsonAsync("/api/v1/auth/accept-invitation", new { token, password = "Clave12345" })).DataAsync();
                api = await ApiClient.LoginAsync(factory, email, "Clave12345");
                accepted.GetProperty("user").GetProperty("isSuperAdmin").GetBoolean().Should().BeFalse();
            }
            foreach (var path in Reads) (await api.Get(path)).StatusCode.Should().Be(HttpStatusCode.Forbidden, role + path);
            (await api.Post("/admin/shops", new { })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await api.Post($"/admin/shops/{login.GetProperty("user").Str("shopId")}/activation", new { })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await api.Post("/admin/users", new { })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await api.Put($"/admin/users/{login.GetProperty("user").Str("id")}", new { })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await api.Post($"/admin/subscriptions/{login.GetProperty("user").Str("organizationId")}", new { })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
            (await api.Put("/admin/plans/Pro", new { monthlyPrice = 1 })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }
    }

    [IntegrationFact]
    public async Task Signup_never_grants_global_privilege_even_with_injected_fields()
    {
        var response = await factory.CreateClient().PostAsJsonAsync("/api/v1/auth/signup", new
        {
            email = $"injection-{Guid.NewGuid():N}@example.test", password = "Clave12345", shopName = "Isolated authorization test",
            ownerName = "Account owner", country = "MX", acceptTerms = true, isSuperAdmin = true, role = "SuperAdmin"
        });
        var data = await response.DataAsync();
        data.GetProperty("user").GetProperty("isSuperAdmin").GetBoolean().Should().BeFalse();
        data.GetProperty("user").Str("role").Should().Be("Admin");
        var api = await ApiClient.LoginAsync(factory, data.GetProperty("user").Str("email"), "Clave12345");
        (await api.Get("/admin/access")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [IntegrationFact]
    public async Task Dashboard_uses_global_real_counts_and_never_calls_shop_turnover_platform_revenue()
    {
        var (owner, _) = await Owner();
        await ApiClient.SignupAsync(factory, "MX");
        var dashboard = await (await owner.Get("/admin/dashboard")).DataAsync();
        (await owner.Get("/admin/dashboard")).Headers.CacheControl!.NoStore.Should().BeTrue();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RepairShopDbContext>();
        dashboard.GetProperty("shops").GetInt32().Should().Be(await db.Shops.CountAsync());
        dashboard.GetProperty("users").GetInt32().Should().Be(await db.Users.CountAsync());
        dashboard.GetProperty("collectedRevenueAvailable").GetBoolean().Should().BeFalse();
        dashboard.GetProperty("registrations").GetArrayLength().Should().Be(6);
        foreach (var path in Reads)
        {
            var res = await owner.Get(path);
            res.StatusCode.Should().Be(HttpStatusCode.OK, path);
            (await res.Content.ReadAsStringAsync()).Should().NotContain("passwordHash").And.NotContain("securityStamp").And.NotContain("pendingTokenHash").And.NotContain("providerCustomerId");
        }
    }

    [IntegrationFact]
    public async Task Registration_creates_real_Mexican_shop_trial_and_pending_owner_without_leaking_tokens()
    {
        var (owner, _) = await Owner();
        var name = "Command registration " + Guid.NewGuid().ToString("N")[..8];
        var email = $"registered-{Guid.NewGuid():N}@example.test";
        var response = await owner.Post("/admin/shops", new { name, ownerName = "Owner invitation", ownerEmail = email });
        var row = await response.DataAsync();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RepairShopDbContext>();
        var shop = await db.Shops.SingleAsync(s => s.Id == Guid.Parse(row.Str("id")));
        shop.DefaultCurrency.Should().Be("MXN"); shop.TimeZone.Should().Be("America/Mexico_City");
        var sub = await db.Subscriptions.SingleAsync(s => s.OrganizationId == shop.OrganizationId);
        (sub.TrialEndsAtUtc - sub.CreatedAtUtc).Should().Be(TimeSpan.FromDays(15));
        var user = await db.Users.SingleAsync(u => u.Email == email);
        user.HasPendingInvitation.Should().BeTrue(); user.IsSuperAdmin.Should().BeFalse();
        var body = await response.Content.ReadAsStringAsync();
        body.Should().NotContain("token=").And.NotContain("password");
        var search = await (await owner.Get("/admin/shops?q=" + Uri.EscapeDataString(name))).DataAsync();
        search.EnumerateArray().Should().Contain(s => s.Str("id") == row.Str("id"));
        var duplicate = await owner.Post("/admin/shops", new { name = "Must roll back", ownerName = "Same owner", ownerEmail = email });
        duplicate.StatusCode.Should().Be(HttpStatusCode.Conflict);
        (await db.Shops.AnyAsync(s => s.Name == "Must roll back")).Should().BeFalse();
    }

    [IntegrationFact]
    public async Task Suspension_blocks_existing_tokens_immediately_and_reactivation_persists()
    {
        var (owner, _) = await Owner(); var (target, session) = await ApiClient.SignupAsync(factory, "MX");
        var id = session.GetProperty("user").Str("shopId");
        (await target.Get("/customers")).StatusCode.Should().Be(HttpStatusCode.OK); // prime security-stamp cache
        var detail = await (await owner.Get($"/admin/shops/{id}")).DataAsync();
        await (await owner.Post($"/admin/shops/{id}/activation", new { isActive = false, reason = "Security suspension verification", expectedUpdatedAtUtc = detail.GetProperty("shop").Str("updatedAtUtc") })).DataAsync();
        (await target.Get("/customers")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var after = await (await owner.Get($"/admin/shops/{id}")).DataAsync();
        after.GetProperty("shop").GetProperty("isActive").GetBoolean().Should().BeFalse();
        await (await owner.Post($"/admin/shops/{id}/activation", new { isActive = true, reason = "Security reactivation verification", expectedUpdatedAtUtc = after.GetProperty("shop").Str("updatedAtUtc") })).DataAsync();
        (await target.Get("/customers")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [IntegrationFact]
    public async Task Organization_suspension_blocks_all_branches_and_tenant_admin_cannot_reverse_platform_suspension()
    {
        var (owner, _) = await Owner(); var (tenant, login) = await ApiClient.SignupAsync(factory, "MX");
        var organization = login.GetProperty("user").Str("organizationId");
        var a = await (await tenant.Post("/settings/branches", new { name = "Branch A security", copyTemplates = false, copyCatalog = false })).DataAsync();
        var b = await (await tenant.Post("/settings/branches", new { name = "Branch B previously inactive", copyTemplates = false, copyCatalog = false })).DataAsync();
        (await tenant.Post($"/settings/branches/{b.Str("id")}/active?value=false")).StatusCode.Should().Be(HttpStatusCode.NoContent);
        var branch = await ApiClient.LoginAsync(factory, login.GetProperty("user").Str("email"), "Clave12345");
        var switched = await (await branch.Post("/auth/switch-shop", new { shopId = a.Str("id") })).DataAsync();
        branch.UseToken(switched.Str("accessToken"));
        (await branch.Get("/customers")).StatusCode.Should().Be(HttpStatusCode.OK);
        var detail = await (await owner.Get($"/admin/shops/{organization}")).DataAsync();
        await (await owner.Post($"/admin/shops/{organization}/activation", new { isActive = false, reason = "Global organization suspension", expectedUpdatedAtUtc = detail.GetProperty("shop").Str("updatedAtUtc") })).DataAsync();
        (await branch.Get("/customers")).StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var rejectedLogin = await factory.CreateClient().PostAsJsonAsync("/api/v1/auth/login", new { email = login.GetProperty("user").Str("email"), password = "Clave12345" });
        rejectedLogin.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        detail = await (await owner.Get($"/admin/shops/{organization}")).DataAsync();
        await (await owner.Post($"/admin/shops/{organization}/activation", new { isActive = true, reason = "Global organization reactivation", expectedUpdatedAtUtc = detail.GetProperty("shop").Str("updatedAtUtc") })).DataAsync();
        (await branch.Get("/customers")).StatusCode.Should().Be(HttpStatusCode.OK);
        detail = await (await owner.Get($"/admin/shops/{organization}")).DataAsync();
        detail.GetProperty("branches").EnumerateArray().Single(s => s.Str("id") == b.Str("id")).GetProperty("isActive").GetBoolean().Should().BeFalse();
        var branchDetail = await (await owner.Get($"/admin/shops/{a.Str("id")}")).DataAsync();
        await (await owner.Post($"/admin/shops/{a.Str("id")}/activation", new { isActive = false, reason = "Isolated branch global suspension", expectedUpdatedAtUtc = branchDetail.GetProperty("shop").Str("updatedAtUtc") })).DataAsync();
        (await tenant.Post($"/settings/branches/{a.Str("id")}/active?value=true")).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var after = await (await owner.Get($"/admin/shops/{a.Str("id")}")).DataAsync();
        after.GetProperty("shop").GetProperty("isActive").GetBoolean().Should().BeFalse();
        (await tenant.Get("/customers")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [IntegrationFact]
    public async Task Stale_writes_and_missing_reasons_are_rejected_without_partial_changes()
    {
        var (owner, _) = await Owner(); var (_, session) = await ApiClient.SignupAsync(factory, "MX");
        var id = session.GetProperty("user").Str("shopId");
        var detail = await (await owner.Get($"/admin/shops/{id}")).DataAsync();
        var version = detail.GetProperty("shop").Str("updatedAtUtc");
        (await owner.Post($"/admin/shops/{id}/activation", new { isActive = false, reason = "", expectedUpdatedAtUtc = version })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await (await owner.Post($"/admin/shops/{id}/activation", new { isActive = false, reason = "First audited change", expectedUpdatedAtUtc = version })).DataAsync();
        (await owner.Post($"/admin/shops/{id}/activation", new { isActive = true, reason = "Stale second change", expectedUpdatedAtUtc = version })).StatusCode.Should().Be(HttpStatusCode.Conflict);
        var after = await (await owner.Get($"/admin/shops/{id}")).DataAsync();
        after.GetProperty("shop").GetProperty("isActive").GetBoolean().Should().BeFalse();
    }

    [IntegrationFact]
    public async Task Concurrent_mutations_of_the_same_version_allow_exactly_one_commit_and_one_audit()
    {
        var (owner, _) = await Owner(); var (_, target) = await ApiClient.SignupAsync(factory, "MX");
        var id = target.GetProperty("user").Str("shopId");
        var detail = await (await owner.Get($"/admin/shops/{id}")).DataAsync();
        var version = detail.GetProperty("shop").Str("updatedAtUtc");
        var body = new { isActive = false, reason = "Concurrent suspension verification", expectedUpdatedAtUtc = version };
        var replies = await Task.WhenAll(owner.Post($"/admin/shops/{id}/activation", body), owner.Post($"/admin/shops/{id}/activation", body));
        replies.Select(r => r.StatusCode).Should().BeEquivalentTo(new[] { HttpStatusCode.OK, HttpStatusCode.Conflict });
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RepairShopDbContext>();
        (await db.AuditEvents.IgnoreQueryFilters().CountAsync(e => e.EntityId == Guid.Parse(id) && e.Action == "platform_suspended")).Should().Be(1);
    }

    [IntegrationFact]
    public async Task Global_owner_cannot_suspend_own_session_or_be_managed_by_tenant_admin()
    {
        var (owner, login) = await Owner();
        var id = login.GetProperty("user").Str("shopId"); var userId = login.GetProperty("user").Str("id");
        var detail = await (await owner.Get($"/admin/shops/{id}")).DataAsync();
        (await owner.Post($"/admin/shops/{id}/activation", new { isActive = false, reason = "Must not lock out owner", expectedUpdatedAtUtc = detail.GetProperty("shop").Str("updatedAtUtc") })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        (await owner.Post($"/users/{userId}/reset-link")).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await owner.Put($"/users/{userId}", new { displayName = "Cannot change owner", role = "Tech", isActive = true })).StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await owner.Get("/admin/access")).StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [IntegrationFact]
    public async Task Privilege_revocation_is_checked_in_database_on_every_request()
    {
        var (owner, login) = await Owner();
        (await owner.Get("/admin/access")).StatusCode.Should().Be(HttpStatusCode.OK);
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<RepairShopDbContext>();
        var user = await db.Users.SingleAsync(u => u.Id == Guid.Parse(login.GetProperty("user").Str("id")));
        user.SetSuperAdmin(false, DateTime.UtcNow); await db.SaveChangesAsync();
        // Even with a primed JWT/security-stamp cache the uncached global authorization refuses it.
        (await owner.Get("/admin/dashboard")).StatusCode.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.Unauthorized);
    }

    [IntegrationFact]
    public async Task Global_access_does_not_disable_tenant_isolation_or_expose_platform_audit_to_tenant_routes()
    {
        var (owner, _) = await Owner(); var (other, _) = await ApiClient.SignupAsync(factory, "MX");
        var customer = await (await other.Post("/customers", new { fullName = "Isolated customer", phone = "5510000001" })).DataAsync();
        (await owner.Get($"/customers/{customer.Str("id")}")).StatusCode.Should().Be(HttpStatusCode.NotFound);
        var catalog = await (await owner.Get("/admin/plans")).DataAsync();
        var pro = catalog.GetProperty("plans").EnumerateArray().First(p => p.GetProperty("definition").Str("id") == "Pro");
        await (await owner.Put("/admin/plans/Pro", new { monthlyPrice = 601.25m, reason = "Price audit isolation test", expectedUpdatedAtUtc = pro.GetProperty("updatedAtUtc").ValueKind == JsonValueKind.Null ? null : pro.Str("updatedAtUtc") })).DataAsync();
        var global = await (await owner.Get("/admin/audit?q=platform_price_changed")).DataAsync();
        global.GetArrayLength().Should().BeGreaterThan(0);
        var local = await owner.Get("/audit");
        local.StatusCode.Should().Be(HttpStatusCode.OK);
        (await local.Content.ReadAsStringAsync()).Should().NotContain("platform_price_changed");
    }

    [IntegrationFact]
    public async Task Plan_price_is_shared_with_public_catalog_validated_and_concurrency_protected()
    {
        var (owner, _) = await Owner();
        var plans = await (await owner.Get("/admin/plans")).DataAsync();
        var row = plans.GetProperty("plans").EnumerateArray().First(p => p.GetProperty("definition").Str("id") == "Basic");
        string? version = row.GetProperty("updatedAtUtc").ValueKind == JsonValueKind.Null ? null : row.Str("updatedAtUtc");
        foreach (var invalid in new[] { -0.004m, 0m, 1.001m, 1000001m })
            (await owner.Put("/admin/plans/Basic", new { monthlyPrice = invalid, reason = "Invalid monetary value", expectedUpdatedAtUtc = version })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
        await (await owner.Put("/admin/plans/Basic", new { monthlyPrice = 321.50m, reason = "Catalog persistence check", expectedUpdatedAtUtc = version })).DataAsync();
        var publicPlans = await (await factory.CreateClient().GetAsync("/api/v1/billing/plans?country=MX")).DataAsync();
        publicPlans.GetProperty("plans").EnumerateArray().First(p => p.Str("id") == "Basic").Dec("price").Should().Be(321.50m);
        (await owner.Put("/admin/plans/Basic", new { monthlyPrice = 322m, reason = "Stale price edit check", expectedUpdatedAtUtc = version })).StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [IntegrationFact]
    public async Task Subscription_grant_trial_cancel_and_last_shop_admin_guards_persist()
    {
        var (owner, _) = await Owner(); var (_, target) = await ApiClient.SignupAsync(factory, "MX");
        var org = target.GetProperty("user").Str("organizationId");
        async Task<JsonElement> Sub() => (await (await owner.Get($"/admin/shops/{org}")).DataAsync()).GetProperty("subscription");
        foreach (var action in new[] { "complimentary", "plan", "trial", "cancel" })
        {
            var before = await Sub();
            await (await owner.Post($"/admin/subscriptions/{org}", new { action, plan = "Standard", reason = "Local lifecycle verification", expectedUpdatedAtUtc = before.Str("updatedAtUtc") })).DataAsync();
            var after = await Sub();
            if (action == "trial")
            {
                after.Str("status").Should().Be("Trialing"); after.Str("plan").Should().Be("Pro");
                (DateTime.Parse(after.Str("trialEndsAtUtc")).ToUniversalTime() - DateTime.UtcNow).TotalDays.Should().BeInRange(14.99, 15.01);
            }
            if (action == "cancel") after.Str("status").Should().Be("Expired");
        }
        var targetId = target.GetProperty("user").Str("id");
        var users = await (await owner.Get($"/admin/users?shopId={org}")).DataAsync();
        var user = users.EnumerateArray().Single(u => u.Str("id") == targetId);
        (await owner.Put($"/admin/users/{targetId}", new { displayName = "Still owner", role = "Tech", isActive = true,
            reason = "Must retain last administrator", expectedUpdatedAtUtc = user.Str("updatedAtUtc") })).StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
