import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateImportTaskDto } from '../src/import-tasks/dto/create-import-task.dto';

describe('CreateImportTaskDto idempotency contract', () => {
  it('requires a UUID v4 idempotencyKey', async () => {
    const missing = plainToInstance(CreateImportTaskDto, { tenantId: 'tenant-id' });
    const invalid = plainToInstance(CreateImportTaskDto, { tenantId: 'tenant-id', idempotencyKey: 'retry-1' });
    const valid = plainToInstance(CreateImportTaskDto, {
      tenantId: 'tenant-id',
      idempotencyKey: '2d6cb26d-115e-4b92-a467-9464cb446da9',
    });
    expect((await validate(missing)).some((error) => error.property === 'idempotencyKey')).toBe(true);
    expect((await validate(invalid)).some((error) => error.property === 'idempotencyKey')).toBe(true);
    expect(await validate(valid)).toHaveLength(0);
  });
});