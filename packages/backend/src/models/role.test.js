import { describe, it, expect, vi } from 'vitest';
import Role from './role';
import Base from './base.js';
import Permission from './permission.js';
import User from './user.js';
import { createRole } from '../../test/factories/role.js';
import { createPermission } from '../../test/factories/permission.js';
import { createUser } from '../../test/factories/user.js';
import { createSamlAuthProvider } from '../../test/factories/saml-auth-provider.ee.js';

describe('Role model', () => {
  it('tableName should return correct name', () => {
    expect(Role.tableName).toBe('roles');
  });

  it('jsonSchema should have correct validations', () => {
    expect(Role.jsonSchema).toMatchSnapshot();
  });

  it('relationMappingsshould return correct associations', () => {
    const relationMappings = Role.relationMappings();

    const expectedRelations = {
      users: {
        relation: Base.HasManyRelation,
        modelClass: User,
        join: {
          from: 'roles.id',
          to: 'users.role_id',
        },
      },
      permissions: {
        relation: Base.HasManyRelation,
        modelClass: Permission,
        join: {
          from: 'roles.id',
          to: 'permissions.role_id',
        },
      },
    };

    expect(relationMappings).toStrictEqual(expectedRelations);
  });

  it('virtualAttributes should return correct attributes', () => {
    expect(Role.virtualAttributes).toStrictEqual(['isAdmin']);
  });

  describe('isAdmin', () => {
    it('should return true for admin named role', () => {
      const role = new Role();
      role.name = 'Admin';

      expect(role.isAdmin).toBe(true);
    });

    it('should return false for not admin named roles', () => {
      const role = new Role();
      role.name = 'User';

      expect(role.isAdmin).toBe(false);
    });
  });

  it('findAdmin should return admin role', async () => {
    const createdAdminRole = await createRole({ name: 'Admin' });

    const adminRole = await Role.findAdmin();

    expect(createdAdminRole).toStrictEqual(adminRole);
  });

  describe('preventAlteringAdmin', () => {
    it('preventAlteringAdmin should throw an error when altering admin role', () => {
      const role = new Role();
      role.name = 'Admin';

      expect(() => role.preventAlteringAdmin()).toThrowError(
        'The admin role cannot be altered!'
      );
    });

    it('preventAlteringAdmin should not throw an error when altering non-admin roles', () => {
      const role = new Role();
      role.name = 'User';

      expect(() => role.preventAlteringAdmin()).not.toThrowError();
    });
  });

  describe('deletePermissions', () => {
    it("should delete role's permissions", async () => {
      const role = await createRole({ name: 'User' });
      await createPermission({ roleId: role.id });

      await role.deletePermissions();

      expect(await role.$relatedQuery('permissions')).toStrictEqual([]);
    });

    it('should accept transaction', async () => {
      const transaction = vi.fn();

      const relatedQuerySpy = vi
        .spyOn(Role.prototype, '$relatedQuery')
        .mockReturnValue({ delete: () => {} });

      const role = await createRole({ name: 'User' });

      await role.deletePermissions(transaction);

      expect(relatedQuerySpy).toHaveBeenCalledWith('permissions', transaction);
      1;
    });
  });

  describe('createPermissions', () => {
    it('should create permissions', async () => {
      const role = await createRole({ name: 'User' });

      await role.createPermissions([
        { action: 'read', subject: 'Flow', conditions: [] },
      ]);

      expect(await role.$relatedQuery('permissions')).toMatchObject([
        {
          action: 'read',
          subject: 'Flow',
          conditions: [],
        },
      ]);
    });

    it('should call Permission.filter', async () => {
      const role = await createRole({ name: 'User' });

      const permissions = [{ action: 'read', subject: 'Flow', conditions: [] }];

      const permissionFilterSpy = vi
        .spyOn(Permission, 'filter')
        .mockReturnValue(permissions);

      await role.createPermissions(permissions);

      expect(permissionFilterSpy).toHaveBeenCalledWith(permissions);
    });

    it('should accept transaction', async () => {
      const transaction = vi.fn();

      const permissionQuerySpy = vi
        .spyOn(Permission, 'query')
        .mockReturnValue({ insert: () => {} });

      const role = await createRole({ name: 'User' });

      await role.createPermissions(
        [{ action: 'read', subject: 'Flow', conditions: [] }],
        transaction
      );

      expect(permissionQuerySpy).toHaveBeenCalledWith(transaction);
      1;
    });
  });

  it('overridePermissions should delete existing permissions and create new permissions', async () => {
    const permissionsData = [
      { action: 'read', subject: 'Flow', conditions: [] },
    ];

    const transaction = vi.fn();
    const deletePermissionsSpy = vi
      .spyOn(Role.prototype, 'deletePermissions')
      .mockResolvedValueOnce();
    const createPermissionsSpy = vi
      .spyOn(Role.prototype, 'createPermissions')
      .mockResolvedValueOnce();

    const role = await createRole({ name: 'User' });

    await role.overridePermissions(permissionsData, transaction);

    expect(deletePermissionsSpy.mock.invocationCallOrder[0]).toBeLessThan(
      createPermissionsSpy.mock.invocationCallOrder[0]
    );

    expect(deletePermissionsSpy).toHaveBeenNthCalledWith(1, transaction);
    expect(createPermissionsSpy).toHaveBeenNthCalledWith(
      1,
      permissionsData,
      transaction
    );
  });

  describe('updateWithPermissions', () => {
    it('should update role along with given permissions', async () => {
      const role = await createRole({ name: 'User' });
      await createPermission({
        roleId: role.id,
        subject: 'Flow',
        action: 'read',
        conditions: [],
      });

      const newRoleData = {
        name: 'Updated user',
        description: 'Updated description',
        permissions: [
          {
            action: 'update',
            subject: 'Flow',
            conditions: [],
          },
        ],
      };

      await role.updateWithPermissions(newRoleData);

      const roleWithPermissions = await role
        .$query()
        .leftJoinRelated({ permissions: true })
        .withGraphFetched({ permissions: true });

      expect(roleWithPermissions).toMatchObject(newRoleData);
    });

    it('should throw an error while updating the admin role', async () => {
      const role = new Role();
      role.name = 'Admin';

      await expect(() => role.updateWithPermissions()).rejects.toThrowError(
        'The admin role cannot be altered!'
      );
    });

    it('should use transaction', async () => {
      const transaction = vi.fn();
      const overridePermissionsSpy = vi
        .spyOn(Role.prototype, 'overridePermissions')
        .mockResolvedValue();

      const querySpy = vi.spyOn(Role.prototype, '$query').mockReturnValue({
        patch: vi.fn().mockReturnValue(Promise.resolve()),
        leftJoinRelated: vi.fn().mockReturnThis(),
        withGraphFetched: vi.fn().mockResolvedValue({}),
      });

      const transactionSpy = vi
        .spyOn(Role, 'transaction')
        .mockImplementation(async (callback) => {
          return await callback(transaction);
        });
      const role = await createRole({ name: 'User' });

      const newRoleData = {
        name: 'New user',
        description: 'Updated user role',
        permissions: [{ action: 'read', subject: 'Flow', conditions: [] }],
      };

      await role.updateWithPermissions(newRoleData);

      expect(transactionSpy).toHaveBeenCalledOnce();

      expect(overridePermissionsSpy).toHaveBeenCalledWith(
        newRoleData.permissions,
        transaction
      );

      expect(querySpy).toHaveBeenNthCalledWith(2, transaction);
    });

    it('should revert changes when an error occurs', async () => {
      const role = await createRole({ name: 'User' });
      await createPermission({
        roleId: role.id,
        subject: 'Flow',
        action: 'read',
        conditions: [],
      });

      const roleWithPermissions = await role
        .$query()
        .leftJoinRelated({ permissions: true })
        .withGraphFetched({ permissions: true });

      await expect(() =>
        role.updateWithPermissions({
          name: false,
          description: 123,
        })
      ).rejects.toThrowError(
        'name: must be string, description: must be string,null'
      );

      const refetchedRoleWithPermissions = await role
        .$query()
        .leftJoinRelated({ permissions: true })
        .withGraphFetched({ permissions: true });

      expect(roleWithPermissions).toStrictEqual(refetchedRoleWithPermissions);
    });
  });

  describe('deleteWithPermissions', () => {
    it('should delete role along with given permissions', async () => {
      const role = await createRole({ name: 'User' });
      await createPermission({
        roleId: role.id,
        subject: 'Flow',
        action: 'read',
        conditions: [],
      });

      await role.deleteWithPermissions();

      const refetchedRole = await role.$query();
      const rolePermissions = await Permission.query().where({
        roleId: role.id,
      });

      expect(refetchedRole).toBe(undefined);
      expect(rolePermissions).toStrictEqual([]);
    });

    it('should use transaction', async () => {
      const transaction = vi.fn();
      const deletePermissionsSpy = vi
        .spyOn(Role.prototype, 'deletePermissions')
        .mockResolvedValue();

      const querySpy = vi.spyOn(Role.prototype, '$query').mockReturnValue({
        delete: vi.fn().mockReturnValue(Promise.resolve()),
      });

      const transactionSpy = vi
        .spyOn(Role, 'transaction')
        .mockImplementation(async (callback) => {
          return await callback(transaction);
        });
      const role = await createRole({ name: 'User' });

      await role.deleteWithPermissions();

      expect(transactionSpy).toHaveBeenCalledOnce();

      expect(deletePermissionsSpy).toHaveBeenCalledWith(transaction);

      expect(querySpy).toHaveBeenCalledWith(transaction);
    });
  });

  describe('assertNoRoleUserExists', () => {
    it('should reject with an error when the role has users', async () => {
      const role = await createRole({ name: 'User' });
      await createUser({ roleId: role.id });

      await expect(() => role.assertNoRoleUserExists()).rejects.toThrowError(
        `All users must be migrated away from the "User" role.`
      );
    });

    it('should resolve when the role does not have any users', async () => {
      const role = await createRole();

      expect(await role.assertNoRoleUserExists()).toBe(undefined);
    });
  });

  describe('assertNoConfigurationUsage', () => {
    it('should reject with an error when the role is used in configuration', async () => {
      const role = await createRole();
      await createSamlAuthProvider({ defaultRoleId: role.id });

      await expect(() =>
        role.assertNoConfigurationUsage()
      ).rejects.toThrowError(
        'samlAuthProvider: You need to change the default role in the SAML configuration before deleting this role.'
      );
    });

    it('should resolve when the role does not have any users', async () => {
      const role = await createRole();

      expect(await role.assertNoConfigurationUsage()).toBe(undefined);
    });
  });

  it('assertRoleIsNotUsed should call assertNoRoleUserExists and assertNoConfigurationUsage', async () => {
    const role = new Role();

    const assertNoRoleUserExistsSpy = vi
      .spyOn(role, 'assertNoRoleUserExists')
      .mockResolvedValue();

    const assertNoConfigurationUsageSpy = vi
      .spyOn(role, 'assertNoConfigurationUsage')
      .mockResolvedValue();

    await role.assertRoleIsNotUsed();

    expect(assertNoRoleUserExistsSpy).toHaveBeenCalledOnce();
    expect(assertNoConfigurationUsageSpy).toHaveBeenCalledOnce();
  });

  describe('$beforeDelete', () => {
    it('should call preventAlteringAdmin', async () => {
      const role = await createRole({ name: 'User' });

      const preventAlteringAdminSpy = vi
        .spyOn(role, 'preventAlteringAdmin')
        .mockResolvedValue();

      await role.$query().delete();

      expect(preventAlteringAdminSpy).toHaveBeenCalledOnce();
    });

    it('should call assertRoleIsNotUsed', async () => {
      const role = await createRole({ name: 'User' });

      const assertRoleIsNotUsedSpy = vi
        .spyOn(role, 'assertRoleIsNotUsed')
        .mockResolvedValue();

      await role.$query().delete();

      expect(assertRoleIsNotUsedSpy).toHaveBeenCalledOnce();
    });
  });
});