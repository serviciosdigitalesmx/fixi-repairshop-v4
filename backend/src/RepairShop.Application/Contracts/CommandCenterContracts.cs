using System.ComponentModel.DataAnnotations;
using RepairShop.Domain.Users;
namespace RepairShop.Application.Contracts;

public sealed record RegisterManagedShopRequest(
    [Required, StringLength(120, MinimumLength = 2)] string Name,
    [Required, EmailAddress, StringLength(180)] string OwnerEmail,
    [Required, StringLength(120, MinimumLength = 2)] string OwnerName);
public sealed record ShopActivationRequest(bool IsActive, [Required, StringLength(500, MinimumLength = 5)] string Reason, DateTime ExpectedUpdatedAtUtc);
public sealed record ManagedUserRequest([Required, StringLength(120, MinimumLength = 2)] string DisplayName, UserRole Role, bool IsActive,
    [Required, StringLength(500, MinimumLength = 5)] string Reason, DateTime ExpectedUpdatedAtUtc);
public sealed record ManagedInviteRequest(Guid ShopId, [Required, EmailAddress, StringLength(180)] string Email,
    [Required, StringLength(120, MinimumLength = 2)] string DisplayName, UserRole Role);
public sealed record ManagedSubscriptionRequest([Required] string Action, [Required] string Plan,
    [Required, StringLength(500, MinimumLength = 5)] string Reason, DateTime ExpectedUpdatedAtUtc);
public sealed record ManagedPriceRequest(decimal MonthlyPrice, [Required, StringLength(500, MinimumLength = 5)] string Reason, DateTime? ExpectedUpdatedAtUtc);
public sealed record ManagedShopResponse(Guid Id, Guid OrganizationId, string Name, bool IsActive, bool OrganizationIsActive, string? Country,
    DateTime CreatedAtUtc, DateTime UpdatedAtUtc, int Users, int Branches, string? Plan, string? SubscriptionStatus, DateTime? ExpiresAtUtc);
public sealed record ManagedUserResponse(Guid Id, Guid ShopId, string ShopName, string Email, string DisplayName, string Role,
    bool IsActive, bool IsSuperAdmin, bool HasPendingInvitation, DateTime? LastLoginAtUtc, DateTime CreatedAtUtc, DateTime UpdatedAtUtc);
public sealed record ManagedSubscriptionResponse(Guid OrganizationId, string ShopName, string Plan, string Status, string Provider,
    DateTime TrialEndsAtUtc, DateTime? CurrentPeriodEndsAtUtc, decimal? Amount, string? Currency, DateTime UpdatedAtUtc, bool ExternallyManaged);
