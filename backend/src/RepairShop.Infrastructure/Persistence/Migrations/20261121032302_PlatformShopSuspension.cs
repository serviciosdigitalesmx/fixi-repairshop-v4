using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RepairShop.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class PlatformShopSuspension : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsPlatformSuspended",
                table: "shops",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsPlatformSuspended",
                table: "shops");
        }
    }
}
