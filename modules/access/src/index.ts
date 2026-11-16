import { defineModule } from '@aicommerce/core'
import { createAdmin, disableAdmin, listAdmins, setRoles } from './admins.js'
import { createRole, deleteRole, listRoles, updateRole } from './roles.js'

export {
  createAdmin,
  createRole,
  deleteRole,
  disableAdmin,
  listAdmins,
  listRoles,
  setRoles,
  updateRole,
}

/** Admin roles and accounts. */
export const access = defineModule({
  name: 'access',
  namespaces: ['role', 'admin'],
  actions: [
    listRoles,
    createRole,
    updateRole,
    deleteRole,
    listAdmins,
    createAdmin,
    setRoles,
    disableAdmin,
  ],
})
