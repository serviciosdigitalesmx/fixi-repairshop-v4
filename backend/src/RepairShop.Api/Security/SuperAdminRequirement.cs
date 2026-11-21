using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using RepairShop.Api.Common;
using RepairShop.Infrastructure.Persistence;

namespace RepairShop.Api.Security;

public sealed class SuperAdminRequirement : IAuthorizationRequirement { }

// Resolve the privilege from the database on EVERY request, never from a browser flag or stale JWT role.
public sealed class SuperAdminHandler(RepairShopDbContext db) : AuthorizationHandler<SuperAdminRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, SuperAdminRequirement requirement)
    {
        var id = CurrentUser.GetUserId(context.User);
        var stamp = context.User.FindFirst(ClaimNames.SecurityStamp)?.Value;
        if (id != Guid.Empty && await db.Users.AsNoTracking().AnyAsync(u =>
            u.Id == id && u.IsActive && u.IsSuperAdmin && u.SecurityStamp == stamp))
            context.Succeed(requirement);
    }
}
