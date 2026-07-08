import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module';

interface LoginResponse {
  accessToken: string;
  user: { id: string; tenantId?: string | null; role: string };
}

interface PageResponse<T> {
  items: T[];
  total: number;
}

interface TenantCreateResponse {
  tenantId: string;
  tenantCode: string;
  accountUserId?: string;
}

interface CustomerResponse {
  id: string;
  tenantId: string;
  name: string;
  phone?: string | null;
}

interface OptometryOrderResponse {
  id: string;
  tenantId: string;
  customerId: string;
  farRightSph?: string | null;
  farLeftCyl?: string | null;
  nearRightAdd?: string | null;
  nearLeftBcva?: string | null;
  farPd?: string | null;
  rightHeight?: string | null;
  [key: string]: unknown;
}

interface FittingOrderResponse {
  id: string;
  tenantId: string;
  customerId: string;
  optometryOrderId: string;
  frameInfo?: string | null;
  framePrice: string;
  lensInfo?: string | null;
  lensPrice: string;
  otherInfo?: string | null;
  otherPrice: string;
  totalAmount: string;
  [key: string]: unknown;
}

interface ProductItemResponse {
  id: string;
  category: string;
  name: string;
  defaultPrice: string;
  usageCount: number;
}
interface TenantUserResponse {
  id: string;
  tenantId: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
}

interface BatchDeleteResponse {
  deletedCount: number;
  relatedDeleted?: Record<string, number>;
}

interface TenantDetailResponse {
  counts: {
    users: number;
    customers: number;
    optometryOrders: number;
    fittingOrders: number;
  };
  users: TenantUserResponse[];
  recentCustomers: CustomerResponse[];
  recentOptometryOrders: OptometryOrderResponse[];
  recentFittingOrders: FittingOrderResponse[];
}
interface ImportTaskRowResponse {
  id: string;
  rowNo: number;
  importCustomerNo?: string | null;
  status: string;
  customerId?: string | null;
  optometryOrderId?: string | null;
  errorMessage?: string | null;
}

interface ImportTaskResponse {
  id: string;
  tenantId: string;
  fileName: string;
  status: string;
  totalRows: number;
  processedRows: number;
  successRows: number;
  failedRows: number;
  rolledBackAt?: string | null;
  rollbackCustomers: number;
  rollbackOptometryOrders: number;
  rollbackFittingOrders: number;
  rows?: ImportTaskRowResponse[];
}

describe('NEye MVP API e2e', () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const systemUsername = `e2e_admin_${suffix}`;
  const systemPassword = 'E2eSystem123456';
  const tenantAAccount = `e2e_ta_${suffix}`;
  const tenantBAccount = `e2e_tb_${suffix}`;
  const tenantAExtraAccount = `e2e_ta_extra_${suffix}`;
  const tenantPassword = 'E2eTenant123456';
  const tenantIds: string[] = [];
  const usernames = [systemUsername, tenantAAccount, tenantBAccount, tenantAExtraAccount];
  const frameInfo = `E2E Frame ${suffix}`;

  let app: INestApplication;
  let baseUrl: string;

  async function requestJson<T>(
    path: string,
    options: { body?: unknown; method?: string; token?: string } = {},
    expectedStatus: number | number[] = [200, 201],
  ): Promise<T> {
    const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!expected.includes(response.status)) {
      throw new Error(`Expected ${expected.join('/')} for ${path}, got ${response.status}: ${text}`);
    }
    return data as T;
  }

  async function login(username: string, password: string) {
    return requestJson<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { username, password },
    });
  }
  async function requestBinary(
    path: string,
    options: { method?: string; token?: string } = {},
    expectedStatus: number | number[] = [200, 201],
  ): Promise<ArrayBuffer> {
    const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
    });
    const body = await response.arrayBuffer();
    if (!expected.includes(response.status)) {
      throw new Error(`Expected ${expected.join('/')} for ${path}, got ${response.status}: ${Buffer.from(body).toString('utf8')}`);
    }
    return body;
  }

  async function requestForm<T>(
    path: string,
    formData: FormData,
    options: { method?: string; token?: string } = {},
    expectedStatus: number | number[] = [200, 201],
  ): Promise<T> {
    const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'POST',
      headers: {
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: formData,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!expected.includes(response.status)) {
      throw new Error(`Expected ${expected.join('/')} for ${path}, got ${response.status}: ${text}`);
    }
    return data as T;
  }

  function createCustomerOptometryWorkbook() {
    const headers = [
      '客户导入编号', '客户姓名', '手机号', '性别', '年龄', '客户备注', '验光日期',
      '远用右眼球光', '远用右眼散光', '远用右眼轴线', '远用右眼加光',
      '远用左眼球光', '远用左眼散光', '远用左眼轴线', '远用左眼加光',
      '近用右眼球光', '近用右眼加光', '近用左眼球光', '近用左眼加光',
      '远用总瞳距', '远用右眼瞳距', '远用左眼瞳距', '近用瞳距', '右眼瞳高', '左眼瞳高', '验光备注',
    ];
    const workbook = XLSX.utils.book_new();
    const rows = [
      headers,
      [`IMP-C001-${suffix}`, `E2E Import Customer ${suffix}`, '13600000001', '男', 28, '导入客户', '2026-07-01', '-1.00', '', '', '', '-1.25', '', '', '', '', '', '', '', '62', '31', '31', '', '18', '18', '第一次导入'],
      [`IMP-C001-${suffix}`, '', '', '', '', '', '2026-07-02', '-1.50', '', '', '', '-1.75', '', '', '', '', '', '', '', '62.5', '31.25', '31.25', '', '', '', '同一客户第二张验光单'],
      [`IMP-C002-${suffix}`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '1.50', '', '1.50', '', '', '', '58', '', '', '姓名与日期为空'],
      [`IMP-C003-${suffix}`, `E2E Import Tolerant ${suffix}`, '', '', '28 years', 'tolerant raw', 'bad-date', '+2.50D', 'DS', 'RK', 'PRA', '-PL', '-8..25', '90+', '60-61', 'ADD', 'VIP', 'PL', '1/2', 'PD 62mm', '31mm', '31mm', '58mm', '18mm', '18mm', 'raw optometry import'],
    ];
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '导入模板');
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  }

  function createImportFormData(tenantId: string) {
    const workbook = createCustomerOptometryWorkbook();
    const formData = new FormData();
    formData.append('tenantId', tenantId);
    formData.append('file', new Blob([new Uint8Array(workbook)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'customer-optometry.xlsx');
    return formData;
  }

  async function waitForImportTask(id: string, token: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const task = await requestJson<ImportTaskResponse>(`/import-tasks/${id}`, { token });
      if (['canceled', 'completed', 'failed'].includes(task.status)) return task;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Import task ${id} did not finish in time`);
  }

  beforeAll(async () => {
    process.env.JWT_SECRET ??= 'test-secret';
    process.env.JWT_EXPIRES_IN ??= '1h';

    await prisma.user.create({
      data: {
        username: systemUsername,
        passwordHash: await bcrypt.hash(systemPassword, 10),
        displayName: 'E2E Admin',
        role: UserRole.admin,
        tenantId: null,
      },
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  });

  afterAll(async () => {
    await app?.close();
    if (tenantIds.length > 0) {
      await prisma.fittingOrder.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.optometryOrder.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.customer.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.productItem.deleteMany({ where: { name: { contains: suffix } } });
      await prisma.importTask.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.user.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    await prisma.user.deleteMany({ where: { username: { in: usernames } } });
    await prisma.$disconnect();
  });

  it('creates tenant-scoped business records and global product items', async () => {
    const systemLogin = await login(systemUsername, systemPassword);
    expect(systemLogin.user.role).toBe('admin');

    const tenantA = await requestJson<TenantCreateResponse>('/tenants', {
      method: 'POST',
      token: systemLogin.accessToken,
      body: {
        name: `E2E Tenant A ${suffix}`,
        accountUsername: tenantAAccount,
        accountPassword: tenantPassword,
        accountDisplayName: 'Tenant A Staff',
      },
    });
    const tenantB = await requestJson<TenantCreateResponse>('/tenants', {
      method: 'POST',
      token: systemLogin.accessToken,
      body: {
        name: `E2E Tenant B ${suffix}`,
        accountUsername: tenantBAccount,
        accountPassword: tenantPassword,
        accountDisplayName: 'Tenant B Staff',
      },
    });
    tenantIds.push(tenantA.tenantId, tenantB.tenantId);

    const tenantALogin = await login(tenantAAccount, tenantPassword);
    const tenantBLogin = await login(tenantBAccount, tenantPassword);
    expect(tenantALogin.user.tenantId).toBe(tenantA.tenantId);
    expect(tenantALogin.user.role).toBe('staff');
    expect(tenantBLogin.user.tenantId).toBe(tenantB.tenantId);
    expect(tenantBLogin.user.role).toBe('staff');
    const templateBinary = await requestBinary('/import-tasks/template/customer-optometry', {
      token: systemLogin.accessToken,
    });
    expect(templateBinary.byteLength).toBeGreaterThan(1024);
    await requestBinary('/import-tasks/template/customer-optometry', { token: tenantALogin.accessToken }, 403);
    await requestJson(`/import-tasks?tenantId=${tenantA.tenantId}`, { token: tenantALogin.accessToken }, 403);
    await requestForm('/import-tasks/customer-optometry', createImportFormData(tenantA.tenantId), { token: tenantALogin.accessToken }, 403);

    const importTask = await requestForm<ImportTaskResponse>('/import-tasks/customer-optometry', createImportFormData(tenantA.tenantId), {
      token: systemLogin.accessToken,
    });
    expect(importTask.tenantId).toBe(tenantA.tenantId);
    expect(importTask.totalRows).toBe(4);

    const finishedImportTask = await waitForImportTask(importTask.id, systemLogin.accessToken);
    expect(finishedImportTask.status).toBe('completed');
    expect(finishedImportTask.successRows).toBe(4);
    expect(finishedImportTask.failedRows).toBe(0);
    expect(finishedImportTask.rows?.length ?? 0).toBe(0);

    const importedCustomers = await requestJson<PageResponse<CustomerResponse>>(
      `/customers?tenantId=${tenantA.tenantId}&keyword=${encodeURIComponent(`E2E Import Customer ${suffix}`)}`,
      { token: systemLogin.accessToken },
    );
    expect(importedCustomers.total).toBe(1);
    const unnamedImportedCustomers = await requestJson<PageResponse<CustomerResponse>>(
      `/customers?tenantId=${tenantA.tenantId}&keyword=${encodeURIComponent(`未命名客户-IMP-C002-${suffix}`)}`,
      { token: systemLogin.accessToken },
    );
    expect(unnamedImportedCustomers.total).toBe(1);

    const importedOrders = await requestJson<PageResponse<OptometryOrderResponse>>(
      `/optometry-orders?tenantId=${tenantA.tenantId}&keyword=${encodeURIComponent(`E2E Import Customer ${suffix}`)}`,
      { token: systemLogin.accessToken },
    );
    expect(importedOrders.total).toBe(2);
    expect(importedOrders.items.some((item) => String(item.farRightSph) === '-1.00')).toBe(true);

    const tolerantOrders = await requestJson<PageResponse<OptometryOrderResponse>>(
      `/optometry-orders?tenantId=${tenantA.tenantId}&keyword=${encodeURIComponent(`E2E Import Tolerant ${suffix}`)}`,
      { token: systemLogin.accessToken },
    );
    expect(tolerantOrders.total).toBe(1);
    const tolerantOrder = tolerantOrders.items[0]!;
    expect(String(tolerantOrder.farRightSph)).toBe('+2.50D');
    expect(String(tolerantOrder.farRightCyl)).toBe('DS');
    expect(String(tolerantOrder.farRightAxis)).toBe('RK');
    expect(String(tolerantOrder.farRightAdd)).toBe('PRA');
    expect(String(tolerantOrder.farLeftSph)).toBe('-PL');
    expect(String(tolerantOrder.farLeftCyl)).toBe('-8..25');
    expect(String(tolerantOrder.farLeftAxis)).toBe('90+');
    expect(String(tolerantOrder.farLeftAdd)).toBe('60-61');
    expect(String(tolerantOrder.nearRightSph)).toBe('ADD');
    expect(String(tolerantOrder.nearRightAdd)).toBe('VIP');
    expect(String(tolerantOrder.nearLeftSph)).toBe('PL');
    expect(String(tolerantOrder.nearLeftAdd)).toBe('1/2');
    expect(String(tolerantOrder.farPd)).toBe('PD 62mm');
    expect(String(tolerantOrder.rightHeight)).toBe('18mm');

    await requestJson(`/import-tasks/${finishedImportTask.id}/rollback`, { method: 'POST', token: tenantALogin.accessToken }, 403);
    const rolledBackImportTask = await requestJson<ImportTaskResponse>(`/import-tasks/${finishedImportTask.id}/rollback`, {
      method: 'POST',
      token: systemLogin.accessToken,
    });
    expect(rolledBackImportTask.rolledBackAt).toBeTruthy();
    expect(rolledBackImportTask.rollbackCustomers).toBe(3);
    expect(rolledBackImportTask.rollbackOptometryOrders).toBe(4);
    expect(rolledBackImportTask.rollbackFittingOrders).toBe(0);
    await requestJson(`/import-tasks/${finishedImportTask.id}/rollback`, { method: 'POST', token: systemLogin.accessToken }, 400);

    const importedCustomersAfterRollback = await requestJson<PageResponse<CustomerResponse>>(
      `/customers?tenantId=${tenantA.tenantId}&keyword=${encodeURIComponent(`E2E Import Customer ${suffix}`)}`,
      { token: systemLogin.accessToken },
    );
    expect(importedCustomersAfterRollback.total).toBe(0);
    const unnamedImportedCustomersAfterRollback = await requestJson<PageResponse<CustomerResponse>>(
      `/customers?tenantId=${tenantA.tenantId}&keyword=${encodeURIComponent(`未命名客户-IMP-C002-${suffix}`)}`,
      { token: systemLogin.accessToken },
    );
    expect(unnamedImportedCustomersAfterRollback.total).toBe(0);
    const tolerantOrdersAfterRollback = await requestJson<PageResponse<OptometryOrderResponse>>(
      `/optometry-orders?tenantId=${tenantA.tenantId}&keyword=${encodeURIComponent(`E2E Import Tolerant ${suffix}`)}`,
      { token: systemLogin.accessToken },
    );
    expect(tolerantOrdersAfterRollback.total).toBe(0);

    await requestJson<ImportTaskResponse>(`/import-tasks/${finishedImportTask.id}`, {
      method: 'DELETE',
      token: systemLogin.accessToken,
    });
    await requestJson(`/import-tasks/${finishedImportTask.id}`, { token: systemLogin.accessToken }, 404);

    const updatedTenantA = await requestJson<{ contactName: string; contactPhone: string; status: string }>(`/tenants/${tenantA.tenantId}`, {
      method: 'PATCH',
      token: systemLogin.accessToken,
      body: { contactName: 'Updated Contact', contactPhone: '13800000000', status: 'active' },
    });
    expect(updatedTenantA.contactName).toBe('Updated Contact');
    expect(updatedTenantA.contactPhone).toBe('13800000000');

    const tenantAUsers = await requestJson<TenantUserResponse[]>(`/tenants/${tenantA.tenantId}/users`, {
      token: systemLogin.accessToken,
    });
    expect(tenantAUsers.some((item) => item.username === tenantAAccount && item.role === 'staff')).toBe(true);

    const extraUser = await requestJson<TenantUserResponse>(`/tenants/${tenantA.tenantId}/users`, {
      method: 'POST',
      token: systemLogin.accessToken,
      body: { username: tenantAExtraAccount, password: tenantPassword, displayName: 'Tenant A Extra Staff' },
    });
    expect(extraUser.tenantId).toBe(tenantA.tenantId);
    expect(extraUser.role).toBe('staff');
    const extraUserLogin = await login(tenantAExtraAccount, tenantPassword);
    await requestJson<TenantUserResponse>(`/tenants/${tenantA.tenantId}/users/${extraUser.id}`, {
      method: 'PATCH',
      token: systemLogin.accessToken,
      body: { status: 'disabled' },
    });
    await requestJson('/customers', { token: extraUserLogin.accessToken }, 401);
    await requestJson('/auth/login', { method: 'POST', body: { username: tenantAExtraAccount, password: tenantPassword } }, 401);
    await requestJson<TenantUserResponse>(`/tenants/${tenantA.tenantId}/users/${extraUser.id}`, {
      method: 'PATCH',
      token: systemLogin.accessToken,
      body: { status: 'active' },
    });

    const resetPassword = `Reset${suffix.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}!`;
    const resetResult = await requestJson<{ tenantId: string; username: string }>(`/tenants/${tenantA.tenantId}/admin-password`, {
      method: 'PATCH',
      token: systemLogin.accessToken,
      body: { password: resetPassword },
    });
    expect(resetResult.tenantId).toBe(tenantA.tenantId);
    expect(resetResult.username).toBe(tenantAAccount);
    const resetTenantALogin = await login(tenantAAccount, resetPassword);
    expect(resetTenantALogin.user.tenantId).toBe(tenantA.tenantId);
    tenantALogin.accessToken = resetTenantALogin.accessToken;

    const firstCustomer = await requestJson<CustomerResponse>('/customers', {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { name: `E2E Same Name ${suffix}` },
    });
    const secondCustomer = await requestJson<CustomerResponse>('/customers', {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { name: `E2E Same Name ${suffix}` },
    });
    expect(firstCustomer.phone).toBeNull();
    expect(secondCustomer.name).toBe(firstCustomer.name);

    const searchName = `E2E Searchable ${suffix}`;
    const searchPhone = `139${Math.random().toString().slice(2, 10)}`;
    const searchableCustomerA = await requestJson<CustomerResponse>('/customers', {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { name: searchName, phone: searchPhone },
    });
    const searchableCustomerB = await requestJson<CustomerResponse>('/customers', {
      method: 'POST',
      token: tenantBLogin.accessToken,
      body: { name: searchName, phone: searchPhone },
    });

    const customersByNameA = await requestJson<PageResponse<CustomerResponse>>(
      `/customers?keyword=${encodeURIComponent(searchName)}`,
      { token: tenantALogin.accessToken },
    );
    expect(customersByNameA.items.some((item) => item.id === searchableCustomerA.id)).toBe(true);
    expect(customersByNameA.items.some((item) => item.id === searchableCustomerB.id)).toBe(false);
    expect(customersByNameA.items.every((item) => item.tenantId === tenantA.tenantId)).toBe(true);

    const customersByPhoneA = await requestJson<PageResponse<CustomerResponse>>(
      `/customers?keyword=${encodeURIComponent(searchPhone)}`,
      { token: tenantALogin.accessToken },
    );
    expect(customersByPhoneA.items.some((item) => item.id === searchableCustomerA.id)).toBe(true);
    expect(customersByPhoneA.items.some((item) => item.id === searchableCustomerB.id)).toBe(false);
    expect(customersByPhoneA.items.every((item) => item.tenantId === tenantA.tenantId)).toBe(true);

    const customersByPhoneAdmin = await requestJson<PageResponse<CustomerResponse>>(
      `/customers?keyword=${encodeURIComponent(searchPhone)}`,
      { token: systemLogin.accessToken },
    );
    expect(customersByPhoneAdmin.items.some((item) => item.id === searchableCustomerA.id)).toBe(true);
    expect(customersByPhoneAdmin.items.some((item) => item.id === searchableCustomerB.id)).toBe(true);

    const customersByPhoneAdminTenantA = await requestJson<PageResponse<CustomerResponse>>(
      `/customers?keyword=${encodeURIComponent(searchPhone)}&tenantId=${tenantA.tenantId}`,
      { token: systemLogin.accessToken },
    );
    expect(customersByPhoneAdminTenantA.items.some((item) => item.id === searchableCustomerA.id)).toBe(true);
    expect(customersByPhoneAdminTenantA.items.some((item) => item.id === searchableCustomerB.id)).toBe(false);

    await requestJson(
      `/customers/${searchableCustomerB.id}/optometry-orders`,
      { method: 'POST', token: tenantALogin.accessToken, body: { optometryDate: '2026-07-07' } },
      404,
    );

    const optometryOrder = await requestJson<OptometryOrderResponse>(`/customers/${firstCustomer.id}/optometry-orders`, {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: {
        optometryDate: '2026-07-07',
        farRightSph: '-1.25',
        farLeftCyl: '-0.50',
        nearRightAdd: '1.50',
        nearLeftBcva: '1.0',
        farPd: '62.50',
        rightHeight: '18.00',
      },
    });
    expect(optometryOrder.customerId).toBe(firstCustomer.id);
    expect(optometryOrder.tenantId).toBe(tenantA.tenantId);
    expect(String(optometryOrder.farRightSph)).toBe('-1.25');
    expect(String(optometryOrder.farLeftCyl)).toBe('-0.50');
    expect(String(optometryOrder.nearRightAdd)).toBe('1.50');
    expect(String(optometryOrder.nearLeftBcva)).toBe('1.0');
    expect(String(optometryOrder.farPd)).toBe('62.50');
    expect(String(optometryOrder.rightHeight)).toBe('18.00');
    expect(optometryOrder).not.toHaveProperty('birthday');
    expect(optometryOrder).not.toHaveProperty('optometrist');

    const optometryOrderB = await requestJson<OptometryOrderResponse>(`/customers/${searchableCustomerB.id}/optometry-orders`, {
      method: 'POST',
      token: tenantBLogin.accessToken,
      body: { optometryDate: '2026-07-07', farRightSph: '-2.00' },
    });
    await requestJson(
      `/optometry-orders/${optometryOrderB.id}/fitting-orders`,
      { method: 'POST', token: tenantALogin.accessToken, body: { frameInfo: `Cross Tenant Frame ${suffix}`, framePrice: '1.00' } },
      404,
    );

    const firstFitting = await requestJson<FittingOrderResponse>(`/optometry-orders/${optometryOrder.id}/fitting-orders`, {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: {
        frameInfo,
        framePrice: '100.00',
        lensInfo: `E2E Lens ${suffix}`,
        lensPrice: '200.50',
        otherInfo: `E2E Other ${suffix}`,
        otherPrice: '30.50',
      },
    });
    expect(firstFitting.customerId).toBe(firstCustomer.id);
    expect(firstFitting.optometryOrderId).toBe(optometryOrder.id);
    expect(Number(firstFitting.totalAmount)).toBeCloseTo(331);
    expect(firstFitting).not.toHaveProperty('expectedPickupDate');
    expect(firstFitting).not.toHaveProperty('status');

    const secondFitting = await requestJson<FittingOrderResponse>(`/optometry-orders/${optometryOrder.id}/fitting-orders`, {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { frameInfo, framePrice: '120.00' },
    });

    const frameItemsA = await requestJson<PageResponse<ProductItemResponse>>(
      `/product-items?category=frame&keyword=${encodeURIComponent(frameInfo)}`,
      { token: tenantALogin.accessToken },
    );
    expect(frameItemsA.total).toBe(1);
    expect(frameItemsA.items[0]?.usageCount).toBe(2);

    const customerDetail = await requestJson<{ optometryOrders: unknown[]; fittingOrders: unknown[] }>(
      `/customers/${firstCustomer.id}`,
      { token: tenantALogin.accessToken },
    );
    expect(customerDetail.optometryOrders.length).toBeGreaterThanOrEqual(1);
    expect(customerDetail.fittingOrders.length).toBeGreaterThanOrEqual(2);

    await requestJson(`/customers/${firstCustomer.id}`, { token: tenantBLogin.accessToken }, 404);
    await requestJson(`/optometry-orders/${optometryOrder.id}`, { token: tenantBLogin.accessToken }, 404);
    await requestJson(`/fitting-orders/${firstFitting.id}`, { token: tenantBLogin.accessToken }, 404);
    const crossTenantUpdatedFrame = await requestJson<ProductItemResponse>(`/product-items/${frameItemsA.items[0]!.id}`, {
      method: 'PATCH',
      token: tenantBLogin.accessToken,
      body: { remark: 'global product item updated by another tenant' },
    });
    expect(crossTenantUpdatedFrame.id).toBe(frameItemsA.items[0]!.id);

    const frameItemsB = await requestJson<PageResponse<ProductItemResponse>>(
      `/product-items?category=frame&keyword=${encodeURIComponent(frameInfo)}`,
      { token: tenantBLogin.accessToken },
    );
    expect(frameItemsB.total).toBe(1);
    expect(frameItemsB.items[0]?.id).toBe(frameItemsA.items[0]?.id);
    expect(frameItemsB.items[0]?.usageCount).toBe(2);

    const deletedFittings = await requestJson<BatchDeleteResponse>('/fitting-orders/batch-delete', {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { ids: [secondFitting.id] },
    });
    expect(deletedFittings.deletedCount).toBe(1);
    await requestJson(`/fitting-orders/${secondFitting.id}`, { token: tenantALogin.accessToken }, 404);

    const batchOptometryCustomer = await requestJson<CustomerResponse>('/customers', {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { name: `E2E Batch Optometry ${suffix}` },
    });
    const batchOptometry = await requestJson<OptometryOrderResponse>(`/customers/${batchOptometryCustomer.id}/optometry-orders`, {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { optometryDate: '2026-07-07' },
    });
    const batchOptometryFitting = await requestJson<FittingOrderResponse>(`/optometry-orders/${batchOptometry.id}/fitting-orders`, {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { frameInfo: `E2E Batch Frame ${suffix}`, framePrice: '10.00' },
    });
    const deletedOptometry = await requestJson<BatchDeleteResponse>('/optometry-orders/batch-delete', {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { ids: [batchOptometry.id] },
    });
    expect(deletedOptometry.deletedCount).toBe(1);
    expect(deletedOptometry.relatedDeleted?.fittingOrders).toBe(1);
    await requestJson(`/optometry-orders/${batchOptometry.id}`, { token: tenantALogin.accessToken }, 404);
    await requestJson(`/fitting-orders/${batchOptometryFitting.id}`, { token: tenantALogin.accessToken }, 404);

    const batchCustomer = await requestJson<CustomerResponse>('/customers', {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { name: `E2E Batch Customer ${suffix}` },
    });
    const batchCustomerOptometry = await requestJson<OptometryOrderResponse>(`/customers/${batchCustomer.id}/optometry-orders`, {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { optometryDate: '2026-07-07' },
    });
    const batchCustomerFitting = await requestJson<FittingOrderResponse>(`/optometry-orders/${batchCustomerOptometry.id}/fitting-orders`, {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { lensInfo: `E2E Batch Lens ${suffix}`, lensPrice: '20.00' },
    });
    const deletedCustomers = await requestJson<BatchDeleteResponse>('/customers/batch-delete', {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { ids: [batchCustomer.id] },
    });
    expect(deletedCustomers.deletedCount).toBe(1);
    expect(deletedCustomers.relatedDeleted?.optometryOrders).toBe(1);
    expect(deletedCustomers.relatedDeleted?.fittingOrders).toBe(1);
    await requestJson(`/customers/${batchCustomer.id}`, { token: tenantALogin.accessToken }, 404);
    await requestJson(`/optometry-orders/${batchCustomerOptometry.id}`, { token: tenantALogin.accessToken }, 404);
    await requestJson(`/fitting-orders/${batchCustomerFitting.id}`, { token: tenantALogin.accessToken }, 404);

    const batchProductA = await requestJson<ProductItemResponse>('/product-items', {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { category: 'other', name: `E2E Batch Product A ${suffix}`, defaultPrice: '1.00' },
    });
    const batchProductB = await requestJson<ProductItemResponse>('/product-items', {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { category: 'other', name: `E2E Batch Product B ${suffix}`, defaultPrice: '2.00' },
    });
    const deletedProducts = await requestJson<BatchDeleteResponse>('/product-items/batch-delete', {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { ids: [batchProductA.id, batchProductB.id] },
    });
    expect(deletedProducts.deletedCount).toBe(2);
    const batchProductQuery = await requestJson<PageResponse<ProductItemResponse>>(
      `/product-items?category=other&keyword=${encodeURIComponent(`E2E Batch Product ${suffix}`)}`,
      { token: tenantALogin.accessToken },
    );
    expect(batchProductQuery.total).toBe(0);

    const manualProductName = `E2E Manual Lens ${suffix}`;
    const manualProduct = await requestJson<ProductItemResponse>('/product-items', {
      method: 'POST',
      token: tenantALogin.accessToken,
      body: { category: 'lens', name: manualProductName, defaultPrice: '88.00', remark: 'manual create' },
    });
    const manualQuery = await requestJson<PageResponse<ProductItemResponse>>(
      `/product-items?category=lens&keyword=${encodeURIComponent(manualProductName)}`,
      { token: tenantBLogin.accessToken },
    );
    expect(manualQuery.items.some((item) => item.id === manualProduct.id)).toBe(true);

    const updatedManualProduct = await requestJson<ProductItemResponse>(`/product-items/${manualProduct.id}`, {
      method: 'PATCH',
      token: tenantALogin.accessToken,
      body: { defaultPrice: '99.50', remark: 'manual update' },
    });
    expect(Number(updatedManualProduct.defaultPrice)).toBeCloseTo(99.5);

    await requestJson<ProductItemResponse>(`/product-items/${manualProduct.id}`, {
      method: 'DELETE',
      token: tenantALogin.accessToken,
    });
    const manualQueryAfterDelete = await requestJson<PageResponse<ProductItemResponse>>(
      `/product-items?category=lens&keyword=${encodeURIComponent(manualProductName)}`,
      { token: tenantALogin.accessToken },
    );
    expect(manualQueryAfterDelete.items.some((item) => item.id === manualProduct.id)).toBe(false);

    const tenantBDetail = await requestJson<TenantDetailResponse>(`/tenants/${tenantB.tenantId}`, {
      token: systemLogin.accessToken,
    });
    expect(tenantBDetail.counts.users).toBeGreaterThanOrEqual(1);
    expect(tenantBDetail.counts.customers).toBeGreaterThanOrEqual(1);
    expect(tenantBDetail.counts.optometryOrders).toBeGreaterThanOrEqual(1);
    expect(tenantBDetail.recentCustomers.some((item) => item.id === searchableCustomerB.id)).toBe(true);

    const deletedTenantB = await requestJson<BatchDeleteResponse>(`/tenants/${tenantB.tenantId}`, {
      method: 'DELETE',
      token: systemLogin.accessToken,
    });
    expect(deletedTenantB.deletedCount).toBe(1);
    expect(deletedTenantB.relatedDeleted?.users).toBeGreaterThanOrEqual(1);
    expect(deletedTenantB.relatedDeleted?.customers).toBeGreaterThanOrEqual(1);
    expect(deletedTenantB.relatedDeleted?.optometryOrders).toBeGreaterThanOrEqual(1);
    await requestJson(`/tenants/${tenantB.tenantId}`, { token: systemLogin.accessToken }, 404);
    await requestJson('/auth/login', { method: 'POST', body: { username: tenantBAccount, password: tenantPassword } }, 401);

    await requestJson(`/tenants/${tenantA.tenantId}`, {
      method: 'PATCH',
      token: systemLogin.accessToken,
      body: { status: 'disabled' },
    });
    await requestJson('/customers', { token: tenantALogin.accessToken }, 401);
    await requestJson('/auth/login', { method: 'POST', body: { username: tenantAAccount, password: resetPassword } }, 401);
  });
});