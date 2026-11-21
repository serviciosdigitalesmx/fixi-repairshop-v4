using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using RepairShop.Api.Billing;
using RepairShop.Api.Common;
using RepairShop.Api.Security;
using RepairShop.Application.Abstractions;
using RepairShop.Application.Admin;
using RepairShop.Application.Billing;
using RepairShop.Application.Common;
using RepairShop.Application.Contracts;
using RepairShop.Domain.Auditing;
using RepairShop.Domain.Billing;
using RepairShop.Domain.Common;
using RepairShop.Domain.Shops;
using RepairShop.Domain.Users;
using RepairShop.Infrastructure.Persistence;

namespace RepairShop.Api.Controllers;

/// <summary>Deliberate global boundary. Tenant endpoints keep their existing filters and permissions.</summary>
[ApiController, Route("api/v1/admin"), Authorize(Policy = Policies.SuperAdmin), SkipSubscriptionGate]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class CommandCenterController(RepairShopDbContext db, IDateTimeProvider clock, IUnitOfWork uow,
    IShopProvisioner provisioner, UserAdminService users, SubscriptionService billing, IMemoryCache cache) : ControllerBase
{
    [HttpGet("access")]
    public IActionResult Access() => Ok(Envelope.Ok(new { role = "SuperAdmin" }));

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard(CancellationToken ct)
    {
        var now = clock.UtcNow;
        var subs = await db.Subscriptions.AsNoTracking().ToListAsync(ct);
        var live = subs.Where(s => s.EffectiveStatus(now) == SubscriptionStatus.Active).ToList();
        // A subscription amount is a recurring contract, NOT proof of a received payment.
        var mrr = live.Where(s => s.Provider is BillingProvider.MercadoPago or BillingProvider.Paddle && s.Amount > 0 && s.Currency != null)
            .GroupBy(s => s.Currency).Select(g => new { currency = g.Key, amount = g.Sum(s => s.Amount!.Value) });
        var firstMonth = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(-5);
        var registrations = await db.Shops.AsNoTracking().Where(s => s.Id == s.OrganizationId && s.CreatedAtUtc >= firstMonth)
            .GroupBy(s => new { s.CreatedAtUtc.Year, s.CreatedAtUtc.Month })
            .Select(g => new { g.Key.Year, g.Key.Month, Count = g.Count() }).ToListAsync(ct);
        return Ok(Envelope.Ok(new
        {
            generatedAtUtc = now,
            shops = await db.Shops.CountAsync(ct),
            organizations = await db.Shops.Where(s => s.Id == s.OrganizationId).CountAsync(ct),
            activeShops = await db.Shops.CountAsync(s => s.IsActive && !s.IsPlatformSuspended && db.Shops.Any(root => root.Id == s.OrganizationId && !root.IsPlatformSuspended), ct),
            users = await db.Users.CountAsync(ct), activeSubscriptions = live.Count,
            trials = subs.Count(s => s.EffectiveStatus(now) == SubscriptionStatus.Trialing),
            expired = subs.Count(s => s.EffectiveStatus(now) == SubscriptionStatus.Expired),
            expiring = subs.Count(s => s.EffectiveStatus(now) != SubscriptionStatus.Expired &&
                (s.Status == SubscriptionStatus.Trialing ? s.TrialEndsAtUtc : s.CurrentPeriodEndsAtUtc) <= now.AddDays(15)),
            monthlyRecurringRevenue = mrr.ToArray(), collectedRevenueAvailable = false,
            revenueNote = "MRR contratado según suscripciones activas. El sistema no conserva un libro de cobros SaaS confirmados; no representa ingresos cobrados.",
            registrations = Enumerable.Range(0, 6).Select(i => firstMonth.AddMonths(i)).Select(month => new
            {
                month = month.ToString("yyyy-MM"), count = registrations.FirstOrDefault(r => r.Year == month.Year && r.Month == month.Month)?.Count ?? 0
            }),
            plans = Plans.All.Select(p => new { plan = p.Id.ToString(), name = p.Name, count = subs.Count(s => s.Plan == p.Id) })
        }));
    }

    [HttpGet("shops")]
    public async Task<IActionResult> Shops(string? q, bool? active, int skip = 0, int take = 25, CancellationToken ct = default)
    {
        Bounds(skip, take);
        var query = db.Shops.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q)) query = query.Where(s => s.Name.ToLower().Contains(q.Trim().ToLower()));
        if (active is not null) query = query.Where(s => (s.IsActive && !s.IsPlatformSuspended && db.Shops.Any(root => root.Id == s.OrganizationId && !root.IsPlatformSuspended)) == active);
        var total = await query.CountAsync(ct);
        var shops = await query.OrderByDescending(s => s.CreatedAtUtc).ThenBy(s => s.Id).Skip(skip).Take(take).ToListAsync(ct);
        return PageResult(await ShopRows(shops, ct), total);
    }

    [HttpGet("shops/{id:guid}")]
    public async Task<IActionResult> Shop(Guid id, CancellationToken ct)
    {
        var shop = await FindShop(id, ct);
        var branches = await db.Shops.AsNoTracking().Where(s => s.OrganizationId == shop.OrganizationId).OrderBy(s => s.Name).ToListAsync(ct);
        var subscription = await db.Subscriptions.AsNoTracking().SingleOrDefaultAsync(s => s.OrganizationId == shop.OrganizationId, ct);
        return Ok(Envelope.Ok(new { shop = (await ShopRows([shop], ct))[0], branches = await ShopRows(branches, ct),
            subscription = subscription is null ? null : SubscriptionRow(subscription, shop.Name) }));
    }

    [HttpPost("shops")]
    public async Task<IActionResult> Register(RegisterManagedShopRequest body, CancellationToken ct)
    {
        return await Mutate(async () =>
        {
            var now = clock.UtcNow;
            var shop = new Shop(body.Name, null, null, null, "MX", now);
            shop.UpdateRegional("MXN", "MXN", "52", "America/Mexico_City", now);
            db.Shops.Add(shop);
            await uow.SaveChangesAsync(ct);
            db.Subscriptions.Add(Subscription.StartTrial(shop.OrganizationId, "MX", 15, now));
            await provisioner.ProvisionAsync(shop.Id, ct);
            await users.InviteAsync(shop.Id, new CreateUserRequest(body.OwnerEmail, body.OwnerName, UserRole.Admin), CurrentUser.GetActor(User), ct);
            Audit("shop", shop.Id, "registered", "Alta administrativa; prueba de 15 días", new { shop.Name, shop.OrganizationId });
            await uow.SaveChangesAsync(ct);
            return Ok(Envelope.Ok((await ShopRows([shop], ct))[0]));
        }, ct);
    }

    [HttpPost("shops/{id:guid}/activation")]
    public async Task<IActionResult> Activation(Guid id, ShopActivationRequest body, CancellationToken ct)
        => await Mutate(async () =>
        {
            var shop = await FindShop(id, ct);
            CheckVersion(shop.UpdatedAtUtc, body.ExpectedUpdatedAtUtc);
            if (!body.IsActive && (shop.Id == CurrentUser.GetShopId(User) || shop.Id == CurrentUser.GetOrganizationId(User)))
                throw new DomainException("No puedes suspender el taller ni la organización de tu sesión global.");
            if (body.IsActive && shop.Id != shop.OrganizationId && await db.Shops.AnyAsync(s => s.Id == shop.OrganizationId && s.IsPlatformSuspended, ct))
                throw new DomainException("Reactiva primero la organización principal.");
            var sub = await db.Subscriptions.SingleOrDefaultAsync(s => s.OrganizationId == shop.OrganizationId, ct);
            if (body.IsActive && !shop.IsActive && sub is not null &&
                await db.Shops.CountAsync(s => s.OrganizationId == shop.OrganizationId && s.IsActive, ct) >= sub.PlanDefinition.MaxBranches)
                throw new DomainException("La reactivación excede las sucursales permitidas por el plan.");
            var before = new { shop.IsActive, shop.IsPlatformSuspended };
            shop.SetPlatformSuspended(!body.IsActive, clock.UtcNow);
            shop.SetActive(body.IsActive, clock.UtcNow);
            Audit("shop", id, body.IsActive ? "activated" : "suspended", body.Reason, new { before, after = new { shop.IsActive, shop.IsPlatformSuspended } });
            await uow.SaveChangesAsync(ct);
            return Ok(Envelope.Ok((await ShopRows([shop], ct))[0]));
        }, ct);

    [HttpGet("users")]
    public async Task<IActionResult> Users(string? q, Guid? shopId, bool? active, int skip = 0, int take = 25, CancellationToken ct = default)
    {
        Bounds(skip, take);
        var query = db.Users.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q)) query = query.Where(u => u.Email.Contains(q.Trim().ToLower()) || u.DisplayName.ToLower().Contains(q.Trim().ToLower()));
        if (shopId is not null) query = query.Where(u => u.ShopId == shopId);
        if (active is not null) query = query.Where(u => u.IsActive == active);
        var total = await query.CountAsync(ct);
        var list = await query.OrderByDescending(u => u.CreatedAtUtc).ThenBy(u => u.Id).Skip(skip).Take(take)
            .Join(db.Shops, u => u.ShopId, s => s.Id, (u, s) => new ManagedUserResponse(u.Id, u.ShopId, s.Name,
                u.Email, u.DisplayName, u.Role.ToString(), u.IsActive, u.IsSuperAdmin, u.PendingTokenPurpose == UserTokenPurpose.Invitation,
                u.LastLoginAtUtc, u.CreatedAtUtc, u.UpdatedAtUtc)).ToListAsync(ct);
        return PageResult(list, total);
    }

    [HttpPost("users")]
    public async Task<IActionResult> Invite(ManagedInviteRequest body, CancellationToken ct)
        => await Mutate(async () =>
        {
            var shop = await FindShop(body.ShopId, ct);
            if (!shop.IsActive || shop.IsPlatformSuspended || await db.Shops.AnyAsync(s => s.Id == shop.OrganizationId && s.IsPlatformSuspended, ct))
                throw new DomainException("Reactiva la organización y el taller antes de invitar usuarios.");
            var result = await users.InviteAsync(body.ShopId, new CreateUserRequest(body.Email, body.DisplayName, body.Role), CurrentUser.GetActor(User), ct);
            Audit("user", result.User.Id, "invited", "Invitación administrativa", new { shopId = body.ShopId, body.Role });
            await uow.SaveChangesAsync(ct);
            // Do not expose invitation/password-reset credentials in the Command Center.
            return Ok(Envelope.Ok(new { result.User.Id, invitationQueued = true }));
        }, ct);

    [HttpPut("users/{id:guid}")]
    public async Task<IActionResult> UpdateUser(Guid id, ManagedUserRequest body, CancellationToken ct)
        => await Mutate(async () =>
        {
            var user = await db.Users.SingleOrDefaultAsync(u => u.Id == id, ct) ?? throw new NotFoundException("Usuario no encontrado.");
            CheckVersion(user.UpdatedAtUtc, body.ExpectedUpdatedAtUtc);
            if (user.IsSuperAdmin || id == CurrentUser.GetUserId(User)) throw new DomainException("Las cuentas globales se administran exclusivamente desde el servidor.");
            var before = new { user.DisplayName, user.Role, user.IsActive };
            var updated = await users.UpdateAsync(user.ShopId, id, new UpdateUserRequest(body.DisplayName, body.Role, body.IsActive), CurrentUser.GetActor(User), ct);
            Audit("user", id, "updated", body.Reason, new { before, after = new { body.DisplayName, body.Role, body.IsActive } });
            await uow.SaveChangesAsync(ct);
            SecurityStampValidator.Evict(cache, id);
            return Ok(Envelope.Ok(updated));
        }, ct);

    [HttpGet("subscriptions")]
    public async Task<IActionResult> Subscriptions(string? q, string? status, int skip = 0, int take = 25, CancellationToken ct = default)
    {
        Bounds(skip, take);
        if (status is not null && !Enum.TryParse<SubscriptionStatus>(status, out _)) throw new DomainException("Estado de suscripción inválido.");
        var query = from sub in db.Subscriptions.AsNoTracking() join shop in db.Shops on sub.OrganizationId equals shop.Id
                    where q == null || shop.Name.ToLower().Contains(q.Trim().ToLower()) select new { sub, shop.Name };
        var rows = (await query.OrderByDescending(s => s.sub.UpdatedAtUtc).ThenBy(s => s.sub.Id).ToListAsync(ct))
            .Select(x => SubscriptionRow(x.sub, x.Name)).Where(s => status is null || s.Status == status).ToList();
        return PageResult(rows.Skip(skip).Take(take).ToList(), rows.Count);
    }

    [HttpPost("subscriptions/{organizationId:guid}")]
    public async Task<IActionResult> SubscriptionChange(Guid organizationId, ManagedSubscriptionRequest body, CancellationToken ct)
        => await Mutate(async () =>
        {
            if (!Plans.TryParse(body.Plan, out var plan)) throw new DomainException("Plan inválido.");
            var sub = await db.Subscriptions.SingleOrDefaultAsync(s => s.OrganizationId == organizationId, ct)
                ?? throw new NotFoundException("Suscripción no encontrada.");
            CheckVersion(sub.UpdatedAtUtc, body.ExpectedUpdatedAtUtc);
            sub.EnsureLocallyManaged();
            var before = new { sub.Plan, sub.Status, sub.Provider, sub.TrialEndsAtUtc };
            if (body.Action is "complimentary" or "plan" && await db.Shops.CountAsync(s => s.OrganizationId == organizationId && s.IsActive, ct) > Plans.Get(plan).MaxBranches)
                throw new DomainException("El plan no permite el número actual de sucursales activas.");
            switch (body.Action)
            {
                case "trial": sub.RestartTrial(clock.UtcNow); break;
                case "complimentary": sub.GrantComplimentary(plan, clock.UtcNow); break;
                case "plan": sub.ChangePlanLocally(plan, clock.UtcNow); break;
                case "cancel": sub.MarkCanceled(clock.UtcNow); break;
                default: throw new DomainException("Acción de suscripción inválida.");
            }
            Audit("subscription", organizationId, body.Action, body.Reason, new { before, after = new { sub.Plan, sub.Status, sub.Provider, sub.TrialEndsAtUtc } });
            await uow.SaveChangesAsync(ct);
            SubscriptionGateFilter.Evict(cache, organizationId);
            return Ok(Envelope.Ok(SubscriptionRow(sub, (await FindShop(organizationId, ct)).Name)));
        }, ct);

    [HttpGet("plans")]
    public async Task<IActionResult> PlansList(CancellationToken ct)
    {
        var catalog = await billing.ListPlansAsync("MX", ct);
        var versions = await db.PlanPrices.AsNoTracking().ToListAsync(ct);
        return Ok(Envelope.Ok(new { catalog.TrialDays, catalog.Currency, plans = catalog.Plans.Select(p => new { definition = p,
            updatedAtUtc = versions.FirstOrDefault(x => x.Plan.ToString() == p.Id)?.UpdatedAtUtc }) }));
    }

    [HttpPut("plans/{plan}")]
    public async Task<IActionResult> Price(string plan, ManagedPriceRequest body, CancellationToken ct)
        => await Mutate(async () =>
        {
            if (!Plans.TryParse(plan, out var id)) throw new DomainException("Plan inválido.");
            var price = await db.PlanPrices.SingleOrDefaultAsync(p => p.Plan == id, ct);
            if (price?.UpdatedAtUtc != body.ExpectedUpdatedAtUtc) throw new ConflictException("El precio cambió. Recarga antes de guardar.");
            var before = price?.MonthlyPrice;
            if (price is null) db.PlanPrices.Add(new PlanPrice(id, body.MonthlyPrice, clock.UtcNow));
            else price.Update(body.MonthlyPrice, clock.UtcNow);
            Audit("plan", CurrentUser.GetShopId(User), "price_changed", body.Reason, new { plan = id, before, after = body.MonthlyPrice, currency = "MXN" });
            await uow.SaveChangesAsync(ct);
            return Ok(Envelope.Ok(new { plan = id.ToString(), body.MonthlyPrice, currency = "MXN" }));
        }, ct);

    [HttpGet("audit")]
    public async Task<IActionResult> AuditList(string? q, int skip = 0, int take = 25, CancellationToken ct = default)
    {
        Bounds(skip, take);
        var query = db.AuditEvents.IgnoreQueryFilters().AsNoTracking().Where(a => a.EntityType.StartsWith("platform."));
        if (!string.IsNullOrWhiteSpace(q)) query = query.Where(a => a.Action.Contains(q) || (a.ActorEmail != null && a.ActorEmail.Contains(q)));
        var total = await query.CountAsync(ct);
        var rows = await query.OrderByDescending(a => a.CreatedAtUtc).ThenBy(a => a.Id).Skip(skip).Take(take)
            .Select(a => new { a.Id, a.EntityId, a.EntityType, a.Action, a.ActorEmail, a.DataJson, a.CreatedAtUtc }).ToListAsync(ct);
        return PageResult(rows, total);
    }

    private async Task<List<ManagedShopResponse>> ShopRows(List<Shop> shops, CancellationToken ct)
    {
        var ids = shops.Select(s => s.Id).ToList();
        var orgs = shops.Select(s => s.OrganizationId).Distinct().ToList();
        var subscriptions = await db.Subscriptions.AsNoTracking().Where(s => orgs.Contains(s.OrganizationId)).ToDictionaryAsync(s => s.OrganizationId, ct);
        var orgStates = await db.Shops.AsNoTracking().Where(s => orgs.Contains(s.Id)).ToDictionaryAsync(s => s.Id, s => !s.IsPlatformSuspended, ct);
        var counts = await db.Users.Where(u => ids.Contains(u.ShopId)).GroupBy(u => u.ShopId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);
        var branches = await db.Shops.Where(s => orgs.Contains(s.OrganizationId)).GroupBy(s => s.OrganizationId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);
        return shops.Select(s =>
        {
            subscriptions.TryGetValue(s.OrganizationId, out var sub);
            return new ManagedShopResponse(s.Id, s.OrganizationId, s.Name, s.IsActive && !s.IsPlatformSuspended, orgStates.GetValueOrDefault(s.OrganizationId), s.Country, s.CreatedAtUtc, s.UpdatedAtUtc,
                counts.GetValueOrDefault(s.Id), branches.GetValueOrDefault(s.OrganizationId), sub?.Plan.ToString(), sub?.EffectiveStatus(clock.UtcNow).ToString(),
                sub?.Status == SubscriptionStatus.Trialing ? sub.TrialEndsAtUtc : sub?.CurrentPeriodEndsAtUtc);
        }).ToList();
    }
    private ManagedSubscriptionResponse SubscriptionRow(Subscription s, string name) => new(s.OrganizationId, name, s.Plan.ToString(),
        s.EffectiveStatus(clock.UtcNow).ToString(), s.Provider.ToString(), s.TrialEndsAtUtc, s.CurrentPeriodEndsAtUtc, s.Amount, s.Currency, s.UpdatedAtUtc,
        s.Provider is BillingProvider.MercadoPago or BillingProvider.Paddle && s.ProviderSubscriptionId != null);
    private async Task<Shop> FindShop(Guid id, CancellationToken ct)
        => await db.Shops.SingleOrDefaultAsync(s => s.Id == id, ct) ?? throw new NotFoundException("Taller no encontrado.");
    private static void Bounds(int skip, int take)
    {
        if (skip < 0 || take is < 1 or > 100) throw new DomainException("Paginación inválida (máximo 100 registros).");
    }
    private IActionResult PageResult<T>(IReadOnlyList<T> rows, int total)
    {
        Response.Headers[HttpExtensions.TotalCountHeader] = total.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return Ok(Envelope.Ok(rows));
    }
    private static void CheckVersion(DateTime actual, DateTime expected)
    {
        // PostgreSQL timestamps have microsecond precision; JSON can include 100ns .NET ticks.
        if (actual.Ticks / 10 != expected.Ticks / 10) throw new ConflictException("El registro cambió. Recarga antes de guardar.");
    }
    private async Task<IActionResult> Mutate(Func<Task<IActionResult>> work, CancellationToken ct)
        => await uow.InTransactionAsync(async token =>
        {
            // Serialize low-volume global mutations, including last-admin and branch-limit decisions.
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtext('fixi-command-center'))", token);
            return await work();
        }, ct);
    private void Audit(string entity, Guid id, string action, string reason, object data)
    {
        if (string.IsNullOrWhiteSpace(reason) || reason.Trim().Length < 5) throw new DomainException("Indica un motivo de al menos 5 caracteres.");
        db.AuditEvents.Add(new AuditEvent(CurrentUser.GetShopId(User), "platform." + entity, id, "platform_" + action,
            CurrentUser.GetUserId(User), CurrentUser.GetEmail(User), JsonSerializer.Serialize(new { reason = reason.Trim(), data }), clock.UtcNow));
    }
}
