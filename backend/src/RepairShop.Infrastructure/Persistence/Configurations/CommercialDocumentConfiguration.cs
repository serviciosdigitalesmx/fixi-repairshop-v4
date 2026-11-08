using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using RepairShop.Domain.CommercialDocuments;
namespace RepairShop.Infrastructure.Persistence.Configurations;
internal sealed class CommercialDocumentConfiguration : IEntityTypeConfiguration<CommercialDocument>
{
    public void Configure(EntityTypeBuilder<CommercialDocument> b)
    {
        b.ToTable("commercial_documents");
        b.HasKey(d => d.Id);
        b.BelongsToShop();
        b.HasRowVersion();
        b.HasIndex(d => new { d.ShopId, d.Number }).IsUnique();
        b.HasIndex(d => new { d.ShopId, d.SourceType, d.SourceId }).IsUnique().HasFilter("\"Status\" = 1");
        b.Property(d => d.Currency).HasMaxLength(3);
        foreach (var p in new[] { "Subtotal", "DiscountAmount", "Total", "ChangeAmount", "DepositAmountAtIssue", "PaymentsAtIssue", "PaidAtIssue", "BalanceAtIssue" }) b.Property(p).HasColumnType(ConfigurationExtensions.MoneyType);
        b.OwnsOne(d => d.Issuer);
        b.OwnsOne(d => d.Recipient);
        b.HasMany(d => d.Lines).WithOne().HasForeignKey(d => d.CommercialDocumentId).OnDelete(DeleteBehavior.Restrict);
        b.HasMany(d => d.Payments).WithOne().HasForeignKey(d => d.CommercialDocumentId).OnDelete(DeleteBehavior.Restrict);
        b.Navigation(d => d.Lines).UsePropertyAccessMode(PropertyAccessMode.Field);
        b.Navigation(d => d.Payments).UsePropertyAccessMode(PropertyAccessMode.Field);
    }
}
internal sealed class CommercialDocumentLineConfiguration : IEntityTypeConfiguration<CommercialDocumentLine>
{
    public void Configure(EntityTypeBuilder<CommercialDocumentLine> b)
    {
        b.ToTable("commercial_document_lines"); b.HasKey(d => d.Id);
        b.Property(d => d.Quantity).HasPrecision(18,3);
        foreach (var p in new[] { "UnitPrice", "DiscountAmount", "Total" }) b.Property(p).HasColumnType(ConfigurationExtensions.MoneyType);
        b.HasIndex(d => new { d.CommercialDocumentId, d.Position }).IsUnique();
    }
}
internal sealed class CommercialDocumentPaymentConfiguration : IEntityTypeConfiguration<CommercialDocumentPayment>
{
    public void Configure(EntityTypeBuilder<CommercialDocumentPayment> b)
    {
        b.ToTable("commercial_document_payments"); b.HasKey(d => d.Id);
        b.Property(d => d.Amount).HasColumnType(ConfigurationExtensions.MoneyType);
    }
}

