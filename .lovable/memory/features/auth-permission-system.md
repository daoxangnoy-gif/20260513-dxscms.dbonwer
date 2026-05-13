---
name: Auth & Permission System
description: ระบบ Auth + Role + Permission + Menu Control สำหรับ SRR System
type: feature
---
## Authentication
- ใช้ Supabase Auth (Email + Password, auto-confirm)
- คนแรกที่ Signup = Admin อัตโนมัติ, คนถัดไป = Viewer
- Profile auto-created via trigger

## Roles
Admin, Manager, Buyer, Viewer

## Permissions
view_data, calculate, edit_data, export, import_po, manage_user

## Key Functions
- `get_user_permissions(user_id)` — returns role, permissions[], visible_menus[], spc_name, vendor_code
- `has_role(user_id, role)` — security definer
- `has_permission(user_id, perm)` — security definer

## Menu Visibility
- role_menu_permissions controls which menus each role sees
- Sidebar renders dynamically based on canViewMenu()

## Data Access
- profiles.spc_name → filter SRR data to specific SPC
- profiles.vendor_code → filter SRR data to specific Vendor
- Admin/Manager see all data

## Hook
- useAuth() provides: user, hasPermission(), canViewMenu(), isAdmin, signOut()
- Permissions cached after login, refreshable via refreshPermissions()
