import type { AccessMap, Credentials, MultiPermissionMap } from '@solid/community-server';
import { IdentifierSetMultiMap } from '@solid/community-server';
import { PERMISSIONS } from '@solidlab/policy-engine';
import type { CredentialsStorage } from '../../../src/credentials/CredentialsStorage';
import { StoreCredentialsAuthorizer } from '../../../src/credentials/StoreCredentialsAuthorizer';

describe('StoreCredentialsAuthorizer', (): void => {
  const credentials: Credentials = { agent: { webId: 'http://example.com/alice' }};
  const requestedModes: AccessMap = new IdentifierSetMultiMap<string>([
    [{ path: 'http://example.com/foo' }, PERMISSIONS.Read ],
    [{ path: 'http://example.com/bar' }, PERMISSIONS.Read ],
  ]);
  const availablePermissions: MultiPermissionMap = 'permissions' as any;
  let storage: jest.Mocked<CredentialsStorage>;
  let authorizer: StoreCredentialsAuthorizer;

  beforeEach(async(): Promise<void> => {
    storage = {
      set: jest.fn(),
    } satisfies Partial<CredentialsStorage> as any;

    authorizer = new StoreCredentialsAuthorizer(storage);
  });

  it('stores the credentials.', async(): Promise<void> => {
    await expect(authorizer.handle({ credentials, requestedModes, availablePermissions })).resolves.toBeUndefined();
    expect(storage.set).toHaveBeenNthCalledWith(1, { path: 'http://example.com/foo' }, credentials);
    expect(storage.set).toHaveBeenNthCalledWith(2, { path: 'http://example.com/bar' }, credentials);
  });
});
