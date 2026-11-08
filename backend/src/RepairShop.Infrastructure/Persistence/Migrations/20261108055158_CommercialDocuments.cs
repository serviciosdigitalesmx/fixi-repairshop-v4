using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepairShop.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class CommercialDocuments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "commercial_documents",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ShopId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceType = table.Column<int>(type: "integer", nullable: false),
                    SourceId = table.Column<Guid>(type: "uuid", nullable: false),
                    SourceReference = table.Column<string>(type: "text", nullable: true),
                    LogoBase64 = table.Column<string>(type: "text", nullable: true),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    Currency = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    IssuedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    Issuer_Name = table.Column<string>(type: "text", nullable: false),
                    Issuer_LegalName = table.Column<string>(type: "text", nullable: true),
                    Issuer_Phone = table.Column<string>(type: "text", nullable: true),
                    Issuer_Email = table.Column<string>(type: "text", nullable: true),
                    Issuer_Address = table.Column<string>(type: "text", nullable: true),
                    Issuer_City = table.Column<string>(type: "text", nullable: true),
                    Issuer_Country = table.Column<string>(type: "text", nullable: true),
                    Recipient_Name = table.Column<string>(type: "text", nullable: true),
                    Recipient_LegalName = table.Column<string>(type: "text", nullable: true),
                    Recipient_Phone = table.Column<string>(type: "text", nullable: true),
                    Recipient_Email = table.Column<string>(type: "text", nullable: true),
                    Recipient_Address = table.Column<string>(type: "text", nullable: true),
                    Recipient_City = table.Column<string>(type: "text", nullable: true),
                    Recipient_Country = table.Column<string>(type: "text", nullable: true),
                    Subtotal = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    DiscountAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Total = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    ChangeAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    DepositAmountAtIssue = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    PaymentsAtIssue = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    PaidAtIssue = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    BalanceAtIssue = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CancelledAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CancelledByUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    CancellationReason = table.Column<string>(type: "text", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_commercial_documents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_commercial_documents_shops_ShopId",
                        column: x => x.ShopId,
                        principalTable: "shops",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "commercial_document_lines",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CommercialDocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    Sku = table.Column<string>(type: "text", nullable: true),
                    Description = table.Column<string>(type: "text", nullable: false),
                    Quantity = table.Column<decimal>(type: "numeric(18,3)", precision: 18, scale: 3, nullable: false),
                    UnitPrice = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    DiscountAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Total = table.Column<decimal>(type: "numeric(18,2)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_commercial_document_lines", x => x.Id);
                    table.ForeignKey(
                        name: "FK_commercial_document_lines_commercial_documents_CommercialDo~",
                        column: x => x.CommercialDocumentId,
                        principalTable: "commercial_documents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "commercial_document_payments",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    CommercialDocumentId = table.Column<Guid>(type: "uuid", nullable: false),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    Method = table.Column<int>(type: "integer", nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    IsDeposit = table.Column<bool>(type: "boolean", nullable: false),
                    Reference = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_commercial_document_payments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_commercial_document_payments_commercial_documents_Commercia~",
                        column: x => x.CommercialDocumentId,
                        principalTable: "commercial_documents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_commercial_document_lines_CommercialDocumentId_Position",
                table: "commercial_document_lines",
                columns: new[] { "CommercialDocumentId", "Position" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_commercial_document_payments_CommercialDocumentId",
                table: "commercial_document_payments",
                column: "CommercialDocumentId");

            migrationBuilder.CreateIndex(
                name: "IX_commercial_documents_ShopId",
                table: "commercial_documents",
                column: "ShopId");

            migrationBuilder.CreateIndex(
                name: "IX_commercial_documents_ShopId_Number",
                table: "commercial_documents",
                columns: new[] { "ShopId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_commercial_documents_ShopId_SourceType_SourceId",
                table: "commercial_documents",
                columns: new[] { "ShopId", "SourceType", "SourceId" },
                unique: true,
                filter: "\"Status\" = 1");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "commercial_document_lines");

            migrationBuilder.DropTable(
                name: "commercial_document_payments");

            migrationBuilder.DropTable(
                name: "commercial_documents");
        }
    }
}
