import { Module } from '@nestjs/common';
import { AdminOverviewModule } from './admin-overview/admin-overview.module';
import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { FittingOrdersModule } from './fitting-orders/fitting-orders.module';
import { HealthModule } from './health/health.module';
import { ImportTasksModule } from './import-tasks/import-tasks.module';
import { OptometryOrdersModule } from './optometry-orders/optometry-orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductItemsModule } from './product-items/product-items.module';
import { TenantsModule } from './tenants/tenants.module';
import { UsersModule } from './users/users.module';
import { SystemSettingsModule } from './system-settings/system-settings.module';

@Module({
  imports: [
    PrismaModule,
    AdminOverviewModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    CustomersModule,
    OptometryOrdersModule,
    ProductItemsModule,
    FittingOrdersModule,
    ImportTasksModule,
    SystemSettingsModule,
    HealthModule,
  ],
})
export class AppModule {}