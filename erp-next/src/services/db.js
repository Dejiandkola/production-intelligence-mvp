import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

let contextCache = null
let contextCacheTime = 0
const CONTEXT_TTL_MS = 60 * 1000
const QUERY_PAGE_SIZE = 1000

export class NotAuthenticatedError extends Error {
    constructor(message = "User not authenticated") {
        super(message)
        this.name = "NotAuthenticatedError"
    }
}

export class MissingProfileError extends Error {
    constructor(message = "User profile not found. Contact administrator.") {
        super(message)
        this.name = "MissingProfileError"
    }
}

export class MissingRoleError extends Error {
    constructor(message = "User role not assigned. Contact administrator.") {
        super(message)
        this.name = "MissingRoleError"
    }
}

export class PermissionDeniedError extends Error {
    constructor(message = "Permission denied for this action.") {
        super(message)
        this.name = "PermissionDeniedError"
    }
}

async function getContext() {
    const now = Date.now()

    if (contextCache && (now - contextCacheTime) < CONTEXT_TTL_MS) {
        return contextCache
    }

    const { data: userData, error: authError } = await supabase.auth.getUser()

    if (authError || !userData?.user) {
        throw new NotAuthenticatedError()
    }

    const userId = userData.user.id

    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle()

    if (profileError || !profile) {
        throw new MissingProfileError(profileError?.message || "User profile not found.")
    }

    const orgId = profile.organization_id

    const { data: userRole, error: roleError } = await supabase
        .from('user_roles')
        .select('role_id')
        .eq('user_id', userId)
        .eq('organization_id', orgId)
        .limit(1)
        .maybeSingle()

    if (roleError || !userRole?.role_id) {
        throw new MissingRoleError(roleError?.message || "User role not found.")
    }

    const roleId = userRole.role_id

    const { data: roleRow, error: roleNameError } = await supabase
        .from('roles')
        .select('name')
        .eq('id', roleId)
        .limit(1)
        .maybeSingle()

    if (roleNameError || !roleRow) {
        throw new MissingRoleError(roleNameError?.message || "Role record not found.")
    }

    const { data: rolePermissions, error: permLinkError } = await supabase
        .from('role_permissions')
        .select('permission_id')
        .eq('role_id', roleId)

    if (permLinkError) {
        throw new Error(permLinkError.message)
    }

    const permissionIds = (rolePermissions || [])
        .map(row => row.permission_id)
        .filter(Boolean)

    let permissions = []

    if (permissionIds.length > 0) {
        const { data: permissionRows, error: permError } = await supabase
            .from('permissions')
            .select('name')
            .in('id', permissionIds)

        if (permError) {
            throw new Error(permError.message)
        }

        permissions = (permissionRows || []).map(row => row.name).filter(Boolean)
    }

    const ctx = {
        userId,
        organizationId: orgId,
        roleName: roleRow.name,
        permissions
    }

    contextCache = ctx
    contextCacheTime = now

    return ctx
}

function requireOrg(ctx) {
    if (!ctx || !ctx.organizationId) {
        throw new Error("Missing organization context")
    }
}

function requirePermission(ctx, perm) {
    if (!ctx.permissions.includes(perm)) {
        throw new PermissionDeniedError(`Requires ${perm} permission`)
    }
}

function normalizeAssignmentStatus(status) {
    if (status === 'QC_PASSED') return 'Approved'
    if (status === 'QC_FAILED') return 'Rejected'
    return status
}

function normalizeItemStatus(status) {
    if (status === 'COMPLETED') return 'OUT_OF_PRODUCTION'
    if (status === 'IN_QC') return 'IN_PRODUCTION'
    return status
}

function getReceivingStatus(item) {
    return item?.is_received ? 'Received' : 'Not Received'
}

function isApprovedStatus(status) {
    return status === 'Approved' || status === 'QC_PASSED' || status === 'PAID'
}

function isRejectedStatus(status) {
    return status === 'Rejected' || status === 'QC_FAILED'
}

function toDateBoundary(value, boundary) {
    if (!value) return null

    const raw = String(value)
    const day = raw.includes('T') ? raw.split('T')[0] : raw

    return boundary === 'start' ? `${day}T00:00:00.000` : `${day}T23:59:59.999`
}

function mapItemRow(item) {
    return {
        ...item,
        raw_status: item.raw_status || item.status,
        status: normalizeItemStatus(item.status),
        receiving_status: item.receiving_status || getReceivingStatus(item),
        ticket_number: item.ticket_number || item.tickets?.ticket_number,
        customer_name: item.customer_name || item.tickets?.customer_name,
        product_type_name: item.product_type_name || item.product_types?.name,
        work_assignments: item.work_assignments || []
    }
}

export const db = {

    async getCurrentUser() {
        const { data: userData } = await supabase.auth.getUser()
        if (!userData?.user) return null

        const { data: profile } = await supabase
            .from('profiles')
            .select('organization_id')
            .eq('user_id', userData.user.id)
            .limit(1)
            .maybeSingle()

        let roleName = 'No role assigned'

        if (profile?.organization_id) {
            const { data: userRole } = await supabase
                .from('user_roles')
                .select('roles(name)')
                .eq('user_id', userData.user.id)
                .eq('organization_id', profile.organization_id)
                .limit(1)
                .maybeSingle()

            if (userRole && userRole.roles) {
                roleName = Array.isArray(userRole.roles) ? userRole.roles[0]?.name : userRole.roles.name
            }
        }

        return {
            email: userData.user.email,
            roleName: roleName || 'No role assigned'
        }
    },

    async signOut() {
        const { error } = await supabase.auth.signOut()

        contextCache = null

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }
    },

    async getMyPermissions() {
        const ctx = await getContext()
        return ctx.permissions
    },

    // -------------------------
    // MASTER DATA READS
    // -------------------------

    async getProductTypes() {
        const ctx = await getContext()

        const { data, error } = await supabase
            .from('product_types')
            .select('*')
            .eq('organization_id', ctx.organizationId)
            .order('name')

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async getCategories() {
        const ctx = await getContext()

        const { data, error } = await supabase
            .from('category_types')
            .select('*')
            .eq('organization_id', ctx.organizationId)
            .order('name')

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async getTaskTypes() {
        const ctx = await getContext()

        const { data, error } = await supabase
            .from('task_types')
            .select('*')
            .eq('organization_id', ctx.organizationId)

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async getRates() {
        const ctx = await getContext()

        const { data, error } = await supabase
            .from('rate_cards')
            .select(`
                *,
                product_types(name),
                category_types(name),
                task_types(name)
            `)
            .eq('organization_id', ctx.organizationId)

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data.map(rate => ({
            ...rate,
            product_name: rate.product_types?.name,
            category_name: rate.category_types?.name,
            name: rate.task_types?.name
        }))
    },

    async getTailors() {
        const ctx = await getContext()

        const { data, error } = await supabase
            .from('tailors')
            .select('*')
            .eq('organization_id', ctx.organizationId)

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data || []
    },

    async getTailorSpecialPay(tailorId) {
        const ctx = await getContext()

        const { data, error } = await supabase
            .from('tailor_special_pay')
            .select('*')
            .eq('organization_id', ctx.organizationId)
            .eq('tailor_id', tailorId)

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async getTicketByNumber(ticket_number) {

        const ctx = await getContext()

        const { data, error } = await supabase
            .from('tickets')
            .select('*')
            .eq('organization_id', ctx.organizationId)
            .eq('ticket_number', ticket_number)
            .maybeSingle()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async createTicket({ ticket_number, customer_name, branch_id = null, internal_notes = null }) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_production')

        const { data, error } = await supabase
            .from('tickets')
            .insert({
                organization_id: ctx.organizationId,
                branch_id,
                ticket_number,
                customer_name,
                internal_notes,
                status: 'OPEN'
            })
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async createItemsForTicket({ ticket_id, product_type_id, quantity = 1 }) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_production')

        const rows = Array.from({ length: Number(quantity || 1) }).map(() => ({
            organization_id: ctx.organizationId,
            ticket_id,
            product_type_id
        }))

        const { data, error } = await supabase
            .from('items')
            .insert(rows)
            .select()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    // -------------------------
    // MASTER DATA WRITES
    // -------------------------

    async createProductType(name) {

        const ctx = await getContext()
        requirePermission(ctx, 'manage_rates')

        const { data, error } = await supabase
            .from('product_types')
            .insert({
                organization_id: ctx.organizationId,
                name
            })
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async createCategory(name) {

        const ctx = await getContext()
        requirePermission(ctx, 'manage_rates')

        const { data, error } = await supabase
            .from('category_types')
            .insert({
                organization_id: ctx.organizationId,
                name
            })
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async createTaskType(name) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_rates')

        const { data, error } = await supabase
            .from('task_types')
            .insert({
                organization_id: ctx.organizationId,
                name
            })
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async updateProductType(id, updates) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_rates')

        const { data, error } = await supabase
            .from('product_types')
            .update({
                name: updates.name
            })
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async deleteProductType(id) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_rates')

        // Check references
        const [rateCardsRes, itemsRes] = await Promise.all([
            supabase.from('rate_cards').select('*', { count: 'exact', head: true }).eq('organization_id', ctx.organizationId).eq('product_type_id', id),
            supabase.from('items').select('*', { count: 'exact', head: true }).eq('organization_id', ctx.organizationId).eq('product_type_id', id)
        ])

        if (rateCardsRes.error) throw new Error(rateCardsRes.error.message)
        if (itemsRes.error) throw new Error(itemsRes.error.message)
        if (rateCardsRes.count > 0 || itemsRes.count > 0) {
            throw new Error("Cannot delete product type because it is used in items or rate cards.")
        }

        const { error } = await supabase
            .from('product_types')
            .delete()
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }
        return true
    },

    async updateCategory(id, updates) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_rates')

        const { data, error } = await supabase
            .from('category_types')
            .update({
                name: updates.name
            })
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async deleteCategory(id) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_rates')

        const [rateCardsRes, assignmentsRes] = await Promise.all([
            supabase
                .from('rate_cards')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', ctx.organizationId)
                .eq('category_type_id', id),
            supabase
                .from('work_assignments')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', ctx.organizationId)
                .eq('category_type_id', id)
        ])

        if (rateCardsRes.error) throw new Error(rateCardsRes.error.message)
        if (assignmentsRes.error) throw new Error(assignmentsRes.error.message)

        if ((rateCardsRes.count || 0) > 0 || (assignmentsRes.count || 0) > 0) {
            throw new Error("Cannot delete category because it is used in work assignments or rate cards.")
        }

        const { data, error } = await supabase
            .from('category_types')
            .delete()
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .select('id')

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        if (!data || data.length === 0) {
            throw new Error("Delete failed. No category was removed.")
        }

        return true
    },

    async deleteTaskType(id) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_rates')

        const [rateCardsRes, assignmentsRes, specialPayRes] = await Promise.all([
            supabase
                .from('rate_cards')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', ctx.organizationId)
                .eq('task_type_id', id),
            supabase
                .from('work_assignments')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', ctx.organizationId)
                .eq('task_type_id', id),
            supabase
                .from('tailor_special_pay')
                .select('*', { count: 'exact', head: true })
                .eq('organization_id', ctx.organizationId)
                .eq('task_type_id', id)
        ])

        if (rateCardsRes.error) throw new Error(rateCardsRes.error.message)
        if (assignmentsRes.error) throw new Error(assignmentsRes.error.message)
        if (specialPayRes.error) throw new Error(specialPayRes.error.message)

        if ((rateCardsRes.count || 0) > 0 || (assignmentsRes.count || 0) > 0 || (specialPayRes.count || 0) > 0) {
            throw new Error("Cannot delete task type because it is used in work assignments, tailor special pay, or rate cards.")
        }

        const { data, error } = await supabase
            .from('task_types')
            .delete()
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .select('id')

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        if (!data || data.length === 0) {
            throw new Error("Delete failed. No task type was removed.")
        }

        return true
    },

    async createTailor(tailorData) {

        const ctx = await getContext()
        requirePermission(ctx, 'manage_tailors')

        const { data, error } = await supabase
            .from('tailors')
            .insert({
                ...tailorData,
                organization_id: ctx.organizationId
            })
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async updateTailor(id, updates) {

        const ctx = await getContext()
        requirePermission(ctx, 'manage_tailors')

        const { data, error } = await supabase
            .from('tailors')
            .update({
                ...updates,
                organization_id: ctx.organizationId
            })
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async toggleTailorStatus(id) {

        const ctx = await getContext()
        requirePermission(ctx, 'manage_tailors')

        const { data: tailor } = await supabase
            .from('tailors')
            .select('active')
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .single()

        if (!tailor) {
            throw new Error("Tailor not found")
        }

        const { data, error } = await supabase
            .from('tailors')
            .update({ active: !tailor.active })
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data.active
    },

    async deleteTailor(id) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_tailors')

        const { count, error: countError } = await supabase
            .from('work_assignments')
            .select('*', { count: 'exact', head: true })
            .eq('tailor_id', id)
            .eq('organization_id', ctx.organizationId)

        if (countError) {
            console.error(countError)
            throw new Error(countError.message)
        }

        if (count > 0) {
            throw new Error("Cannot delete tailor because they have existing work assignments.")
        }

        const { data, error } = await supabase
            .from('tailors')
            .delete()
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .select('id')

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        if (!data || data.length === 0) {
            throw new Error("Delete failed. Record was not removed. Check RLS delete policy for tailors.")
        }

        return true
    },

    async saveTailorSpecialPay(tailor_id, task_type_id, uplift_pct) {

        const ctx = await getContext()
        requirePermission(ctx, 'manage_tailors')

        const { data, error } = await supabase
            .from('tailor_special_pay')
            .upsert({
                organization_id: ctx.organizationId,
                tailor_id,
                task_type_id,
                uplift_pct
            }, {
                onConflict: 'organization_id,tailor_id,task_type_id'
            })
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async removeTailorSpecialPay(id) {

        const ctx = await getContext()
        requirePermission(ctx, 'manage_tailors')

        const { error } = await supabase
            .from('tailor_special_pay')
            .delete()
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }
    },

    async upsertTailorByName(tailorData) {
        const ctx = await getContext();
        requirePermission(ctx, 'manage_tailors');

        const normalizeName = (value) =>
            String(value || '')
                .trim()
                .replace(/\s+/g, ' ')
                .toLowerCase();

        const normalizeBand = (value) => {
            const cleaned = String(value || '').trim().toLowerCase();
            if (cleaned === 'a' || cleaned === 'band a') return 'A';
            if (cleaned === 'b' || cleaned === 'band b') return 'B';
            return null;
        };

        const rawName = String(tailorData.name || '').trim().replace(/\s+/g, ' ');
        const normalizedName = normalizeName(rawName);
        const band = normalizeBand(tailorData.band);
        const department = String(tailorData.department || '').trim() || '-';

        if (!rawName) {
            throw new Error('Tailor name is required.');
        }

        if (!band) {
            throw new Error(`Invalid band for tailor "${rawName}".`);
        }

        const { data: existingTailors, error: findError } = await supabase
            .from('tailors')
            .select('*')
            .eq('organization_id', ctx.organizationId);

        if (findError) {
            console.error(findError);
            throw new Error(findError.message);
        }

        const existing = (existingTailors || []).find(
            (t) => normalizeName(t.name) === normalizedName
        );

        if (!existing) {
            const { data, error } = await supabase
                .from('tailors')
                .insert({
                    organization_id: ctx.organizationId,
                    name: rawName,
                    department,
                    band,
                    active: true
                })
                .select()
                .single();

            if (error) {
                console.error(error);
                throw new Error(error.message);
            }

            return { action: 'created', data };
        }

        const updates = {};
        let hasChanges = false;

        if ((existing.name || '').trim().replace(/\s+/g, ' ') !== rawName) {
            updates.name = rawName;
            hasChanges = true;
        }

        if ((existing.department || '-') !== department) {
            updates.department = department;
            hasChanges = true;
        }

        if ((existing.band || '').toUpperCase() !== band) {
            updates.band = band;
            hasChanges = true;
        }

        if (existing.active !== true) {
            updates.active = true;
            hasChanges = true;
        }

        if (!hasChanges) {
            return { action: 'unchanged', data: existing };
        }

        const { data, error } = await supabase
            .from('tailors')
            .update({
                ...updates,
                organization_id: ctx.organizationId
            })
            .eq('id', existing.id)
            .eq('organization_id', ctx.organizationId)
            .select()
            .single();

        if (error) {
            console.error(error);
            throw new Error(error.message);
        }

        return { action: 'updated', data };
    },

    // -------------------------
    // TASK TYPES + RATE CARD
    // -------------------------

    async upsertRateCard(payload) {
        const ctx = await getContext()
        const orgId = ctx.organizationId

        const { data, error } = await supabase
            .from('rate_cards')
            .upsert({
                organization_id: orgId,
                product_type_id: payload.product_type_id,
                category_type_id: payload.category_type_id,
                task_type_id: payload.task_type_id,
                band_a_fee: payload.band_a_fee,
                band_b_fee: payload.band_b_fee
            }, {
                onConflict: 'organization_id,product_type_id,category_type_id,task_type_id'
            })
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async createTaskTypeAndRateByIds(payload) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_rates')

        // create task type
        const { data: taskType, error: taskError } = await supabase
            .from('task_types')
            .insert({
                organization_id: ctx.organizationId,
                name: payload.name
            })
            .select()
            .single()

        if (taskError) {
            console.error(taskError)
            throw new Error(taskError.message)
        }

        // upsert rate card
        const rateData = await this.upsertRateCard({
            ...payload,
            task_type_id: taskType.id
        })

        return rateData
    },

    async createTaskAndRate(productName, categoryName, taskName, bandAFee, bandBFee) {
        const ctx = await getContext();
        requirePermission(ctx, 'manage_rates');

        const cleanProductName = String(productName).trim();
        const cleanCategoryName = String(categoryName).trim();
        const cleanTaskName = String(taskName).trim();

        const cleanBandAFee = Number(String(bandAFee).replace(/,/g, '').trim());
        const cleanBandBFee = Number(String(bandBFee).replace(/,/g, '').trim());

        if (!cleanProductName || !cleanCategoryName || !cleanTaskName) {
            throw new Error('Product, Category, and Task names are required.');
        }

        if (Number.isNaN(cleanBandAFee) || Number.isNaN(cleanBandBFee)) {
            throw new Error('Band A Fee and Band B Fee must be valid numbers.');
        }

        // 1. find or create product
        let { data: product, error: productError } = await supabase
            .from('product_types')
            .select('*')
            .eq('organization_id', ctx.organizationId)
            .ilike('name', cleanProductName)
            .maybeSingle();

        if (productError) throw productError;

        if (!product) {
            const { data: newProduct, error: newProductError } = await supabase
                .from('product_types')
                .insert({
                    organization_id: ctx.organizationId,
                    name: cleanProductName
                })
                .select()
                .single();

            if (newProductError) throw newProductError;
            product = newProduct;
        }

        // 2. find or create category
        let { data: category, error: categoryError } = await supabase
            .from('category_types')
            .select('*')
            .eq('organization_id', ctx.organizationId)
            .ilike('name', cleanCategoryName)
            .maybeSingle();

        if (categoryError) throw categoryError;

        if (!category) {
            const { data: newCategory, error: newCategoryError } = await supabase
                .from('category_types')
                .insert({
                    organization_id: ctx.organizationId,
                    name: cleanCategoryName
                })
                .select()
                .single();

            if (newCategoryError) throw newCategoryError;
            category = newCategory;
        }

        // 3. find or create task type
        let { data: taskType, error: taskTypeError } = await supabase
            .from('task_types')
            .select('*')
            .eq('organization_id', ctx.organizationId)
            .ilike('name', cleanTaskName)
            .maybeSingle();

        if (taskTypeError) throw taskTypeError;

        if (!taskType) {
            const { data: newTaskType, error: newTaskTypeError } = await supabase
                .from('task_types')
                .insert({
                    organization_id: ctx.organizationId,
                    name: cleanTaskName
                })
                .select()
                .single();

            if (newTaskTypeError) throw newTaskTypeError;
            taskType = newTaskType;
        }

        // 4. upsert rate card
        const rateData = await this.upsertRateCard({
            product_type_id: product.id,
            category_type_id: category.id,
            task_type_id: taskType.id,
            band_a_fee: cleanBandAFee,
            band_b_fee: cleanBandBFee
        });

        return rateData;
    },

    async updateRateCard(id, payload) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_rates')

        const { data, error } = await supabase
            .from('rate_cards')
            .update({
                product_type_id: payload.product_type_id,
                category_type_id: payload.category_type_id,
                task_type_id: payload.task_type_id,
                band_a_fee: payload.band_a_fee,
                band_b_fee: payload.band_b_fee,
                active: payload.active
            })
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async toggleRateCardStatus(id) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_rates')

        const { data: current, error: fetchError } = await supabase
            .from('rate_cards')
            .select('id, active')
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .single()

        if (fetchError) {
            console.error(fetchError)
            throw new Error(fetchError.message)
        }

        if (!current) {
            throw new Error("Rate card not found")
        }

        const { data, error } = await supabase
            .from('rate_cards')
            .update({ active: !current.active })
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data.active
    },

    async deleteRateCard(id) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_rates')

        // First, optionally check if it's used if needed, but RLS/DB constraints manage this (RESTRICT on work_assignments)
        const { error } = await supabase
            .from('rate_cards')
            .delete()
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }
        return true
    },

    // -------------------------
    // ITEMS
    // -------------------------

    async getItems() {
        const ctx = await getContext()

        const allItems = []
        let from = 0

        while (true) {
            const { data, error } = await supabase
                .from('items')
                .select(`
                    *,
                    tickets(ticket_number, customer_name),
                    product_types(name),
                    work_assignments(
                        id,
                        category_type_id,
                        task_type_id,
                        tailor_id,
                        category_types(name),
                        task_types(name),
                        tailors(name, active, band)
                    )
                `)
                .eq('organization_id', ctx.organizationId)
                .order('created_at', { ascending: false })
                .range(from, from + QUERY_PAGE_SIZE - 1)

            if (error) {
                console.error(error)
                throw new Error(error.message)
            }

            allItems.push(...(data || []))

            if (!data || data.length < QUERY_PAGE_SIZE) break
            from += QUERY_PAGE_SIZE
        }

        // Map foreign relations to expected UI names
        return allItems.map(mapItemRow)
    },

    async getTicketPaginatedItems(filters = {}, page = 1, pageSize = 50, options = {}) {
        const { data, error } = await supabase.rpc('get_ticket_paginated_items', {
            p_ticket_search: filters.ticketId || null,
            p_customer_search: filters.customerName || null,
            p_product_type: filters.productType || null,
            p_category: filters.category || null,
            p_status: filters.status || null,
            p_start_date: toDateBoundary(filters.startDate, 'start'),
            p_end_date: toDateBoundary(filters.endDate, 'end'),
            p_receiving_status: filters.receivingStatus || null,
            p_exclude_cancelled: Boolean(options.excludeCancelled),
            p_exclude_archived: Boolean(options.excludeArchived),
            p_page: page,
            p_page_size: pageSize
        })

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        const rows = data || []
        return {
            items: rows.map(row => mapItemRow(row.item || {})),
            totalTickets: Number(rows[0]?.total_tickets || 0)
        }
    },

    async getProductionItemSummary(filters = {}) {
        const { data, error } = await supabase.rpc('get_production_item_summary', {
            p_ticket_search: filters.ticketId || null,
            p_customer_search: filters.customerName || null,
            p_product_type: filters.productType || null,
            p_status: filters.status || null,
            p_start_date: toDateBoundary(filters.startDate, 'start'),
            p_end_date: toDateBoundary(filters.endDate, 'end')
        })

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        const summary = data?.[0] || {}
        return {
            totalBacklog: Number(summary.total_backlog || 0),
            totalCompleted: Number(summary.total_completed || 0)
        }
    },

    async getItemById(itemId) {
        const ctx = await getContext()

        const { data, error } = await supabase
            .from('items')
            .select(`
                *,
                tickets(ticket_number, customer_name),
                product_types(name),
                work_assignments(
                    id,
                    status,
                    pay_amount,
                    tailors(name),
                    category_types(name),
                    task_types(name)
                )
            `)
            .eq('id', itemId)
            .eq('organization_id', ctx.organizationId)
            .maybeSingle()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        if (!data) return null;

        return {
            ...data,
            raw_status: data.status,
            status: normalizeItemStatus(data.status),
            receiving_status: getReceivingStatus(data),
            ticket_number: data.tickets?.ticket_number,
            customer_name: data.tickets?.customer_name,
            product_type_name: data.product_types?.name
        }
    },

    async getTasksByItemId(itemId) {
        const ctx = await getContext()

        const { data, error } = await supabase
            .from('work_assignments')
            .select(`
                *,
                task_types(name),
                tailors(name),
                category_types(name)
            `)
            .eq('organization_id', ctx.organizationId)
            .eq('item_id', itemId)
            .order('created_at', { ascending: false })

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data.map(task => ({
            ...task,
            raw_status: task.status,
            status: normalizeAssignmentStatus(task.status),
            task_type_name: task.task_types?.name,
            tailor_name: task.tailors?.name,
            category_name: task.category_types?.name
        }))
    },

async updateTicket(id, { customer_name }) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_production')

        const { data, error } = await supabase
            .from('tickets')
            .update({ customer_name })
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .select()
            .single()

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }
        return data
    },

    async deleteTicket(id) {
        const ctx = await getContext()
        if (!ctx.permissions.includes('admin')) {
            throw new PermissionDeniedError('Requires admin permission')
        }

        const { error } = await supabase
            .from('tickets')
            .delete()
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }
        return true
    },
    
    async deleteItem(itemId) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_production')

        // 1. Find the item first so we know its ticket_id
        const { data: item, error: fetchError } = await supabase
            .from('items')
            .select('id, ticket_id')
            .eq('id', itemId)
            .eq('organization_id', ctx.organizationId)
            .maybeSingle()

        if (fetchError) {
            console.error(fetchError)
            throw new Error(fetchError.message)
        }

        if (!item) {
            throw new Error("Item not found.")
        }

        // 2. Delete the item
        const { error: deleteError } = await supabase
            .from('items')
            .delete()
            .eq('id', itemId)
            .eq('organization_id', ctx.organizationId)

        if (deleteError) {
            console.error(deleteError)
            throw new Error(deleteError.message)
        }

        // 3. Check if the ticket still has any remaining items
        const { count, error: countError } = await supabase
            .from('items')
            .select('*', { count: 'exact', head: true })
            .eq('ticket_id', item.ticket_id)
            .eq('organization_id', ctx.organizationId)

        if (countError) {
            console.error(countError)
            throw new Error(countError.message)
        }

        // 4. If no items remain, delete the parent ticket too
        if ((count || 0) === 0) {
            const { error: ticketDeleteError } = await supabase
                .from('tickets')
                .delete()
                .eq('id', item.ticket_id)
                .eq('organization_id', ctx.organizationId)

            if (ticketDeleteError) {
                console.error(ticketDeleteError)
                throw new Error(ticketDeleteError.message)
            }
        }

        return true
    },

    async getPendingPaymentsCount() {
        const ctx = await getContext()

        const { count, error } = await supabase
            .from('work_assignments')
            .select('*', { count: 'exact', head: true })
            .eq('organization_id', ctx.organizationId)
            .eq('status', 'QC_PASSED')

        if (error) {
            console.error(error)
            return 0
        }

        return count || 0
    },

    async getPayrollEntries(startDate, endDate) {
        const ctx = await getContext()

        const rangeStart = toDateBoundary(startDate, 'start')
        const rangeEnd = toDateBoundary(endDate, 'end')

        const allEntries = []
        let from = 0

        while (true) {
            let query = supabase
                .from('work_assignments')
                .select(`
                    id,
                    pay_amount,
                    status,
                    created_at,
                    updated_at,
                    tailor_id,
                    tailors (
                        id,
                        name,
                        band,
                        department
                    )
                `)
                .eq('organization_id', ctx.organizationId)
                .eq('status', 'QC_PASSED')

            if (rangeStart) {
                query = query.gte('updated_at', rangeStart)
            }
            if (rangeEnd) {
                query = query.lte('updated_at', rangeEnd)
            }

            const { data, error } = await query
                .order('updated_at', { ascending: false })
                .range(from, from + QUERY_PAGE_SIZE - 1)

            if (error) {
                console.error(error)
                throw new Error(error.message)
            }

            allEntries.push(...(data || []))

            if (!data || data.length < QUERY_PAGE_SIZE) break
            from += QUERY_PAGE_SIZE
        }

        return allEntries.map(wa => ({
            ...wa,
            tailor_name: wa.tailors?.name || 'Unknown',
            department: wa.tailors?.department || 'Production'
        }))
    },

    async getWeeklyPayroll(startDate, endDate) {
        const rangeStart = toDateBoundary(startDate, 'start')
        const rangeEnd = toDateBoundary(endDate, 'end')

        const { data, error } = await supabase.rpc('get_dashboard_payroll_summary', {
            p_start_date: rangeStart,
            p_end_date: rangeEnd
        })

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data || []
    },

    async getMonthlyPayrollSummary() {
        const { data, error } = await supabase.rpc('get_monthly_payroll_summary')

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data || []
    },

    async createWorkAssignment(payload) {
        const ctx = await getContext();
        requirePermission(ctx, 'manage_qc');

        const { data, error } = await supabase.rpc('create_work_assignment', {
            p_item_id: payload.item_id,
            p_category_type_id: payload.category_type_id,
            p_task_type_id: payload.task_type_id,
            p_tailor_id: payload.tailor_id
        });

        if (error) {
            if (process.env.NODE_ENV !== 'production') {
                console.error('createWorkAssignment error:', error);
            }

            const isDuplicate =
                error.code === '23505' ||
                error.message?.includes('duplicate key value') ||
                error.message?.includes('work_assignments_org_item_cat_task_key');

            if (isDuplicate) {
                throw new Error('This item already has that task under the selected category. Edit the existing task instead.');
            }

            throw new Error(error.message || 'Failed to create work assignment.');
        }

        return data;
    },

    async deleteWorkAssignment(id) {
        const ctx = await getContext()
    if (!ctx.permissions.includes('manage_production') && !ctx.permissions.includes('manage_qc')) {
        throw new PermissionDeniedError('Requires manage_production or manage_qc permission')
    }

        // 1. Fetch assignment and confirm it exists, same org, status = 'CREATED'
        const { data: assignment, error: fetchErr } = await supabase
            .from('work_assignments')
            .select('item_id, status')
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .single()

        if (fetchErr) {
            if (fetchErr.code === 'PGRST116') throw new Error("Work assignment not found.")
            throw new Error(fetchErr.message)
        }

        if (isApprovedStatus(assignment.status) || assignment.status === 'REVERSED') {
            throw new Error("Cannot delete this task because it has already progressed beyond assignment.")
        }

        if (assignment.status !== 'CREATED') {
            throw new Error(`Cannot delete this task. Current status: ${assignment.status}`)
        }

        const itemId = assignment.item_id

        // 2. Delete the assignment
        const { error: deleteErr } = await supabase
            .from('work_assignments')
            .delete()
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)

        if (deleteErr) {
            console.error(deleteErr)
            throw new Error(deleteErr.message)
        }

        // 3. Check remaining assignments for the same item
        const { count, error: countErr } = await supabase
            .from('work_assignments')
            .select('*', { count: 'exact', head: true })
            .eq('item_id', itemId)
            .eq('organization_id', ctx.organizationId)

        if (countErr) throw new Error(countErr.message)

        // 4. If no assignments remain, revert item status to IN_PRODUCTION
        if (count === 0) {
            await this.updateItemStatus(itemId, 'IN_PRODUCTION')
        }

        return true
    },

    async updateWorkAssignment(id, payload) {
        const ctx = await getContext()
    if (!ctx.permissions.includes('manage_production') && !ctx.permissions.includes('manage_qc')) {
        throw new PermissionDeniedError('Requires manage_production or manage_qc permission')
    }

        const { data: assignment, error: fetchErr } = await supabase
            .from('work_assignments')
            .select('item_id, status')
            .eq('id', id)
            .eq('organization_id', ctx.organizationId)
            .single();

        if (fetchErr) {
            if (fetchErr.code === 'PGRST116') throw new Error("Work assignment not found.");
            throw new Error(fetchErr.message);
        }

        if (isApprovedStatus(assignment.status) || assignment.status === 'REVERSED') {
            throw new Error("Cannot edit this task because it has already progressed beyond assignment.");
        }

        if (assignment.status !== 'CREATED') {
            throw new Error(`Cannot edit this task. Current status: ${assignment.status}`);
        }

        const allowedPayload = {
            p_assignment_id: id,
            p_category_type_id: payload.category_type_id,
            p_task_type_id: payload.task_type_id,
            p_tailor_id: payload.tailor_id
        };

        if (!allowedPayload.p_category_type_id || !allowedPayload.p_task_type_id || !allowedPayload.p_tailor_id) {
            throw new Error("Missing required editable fields: category, task, or tailor.");
        }

        const { data, error } = await supabase.rpc('update_work_assignment', allowedPayload);

        if (error) {
            if (process.env.NODE_ENV !== 'production') {
                console.error('updateWorkAssignment error:', error);
            }

            const isDuplicate =
                error.code === '23505' ||
                error.message?.includes('duplicate key value') ||
                error.message?.includes('work_assignments_org_item_cat_task_key');

            if (isDuplicate) {
                throw new Error('This item already has that task under the selected category.');
            }

            throw new Error(error.message || 'Failed to update work assignment.');
        }

        return data;
    },

    async getTasks() {
        const ctx = await getContext()

        const allTasks = []
        let from = 0

        while (true) {
            const { data, error } = await supabase
                .from('work_assignments')
                .select(`
                    *,
                    task_types(name),
                    tailors(name),
                    category_types(name),
                    items(item_key, tickets(customer_name, ticket_number))
                `)
                .eq('organization_id', ctx.organizationId)
                .order('created_at', { ascending: false })
                .range(from, from + QUERY_PAGE_SIZE - 1)

            if (error) {
                console.error(error)
                throw new Error(error.message)
            }

            allTasks.push(...(data || []))

            if (!data || data.length < QUERY_PAGE_SIZE) break
            from += QUERY_PAGE_SIZE
        }

        return allTasks.map(task => ({
            ...task,
            raw_status: task.status,
            status: normalizeAssignmentStatus(task.status),
            task_name: task.task_types?.name,
            task_type_name: task.task_types?.name,
            tailor_name: task.tailors?.name,
            category_name: task.category_types?.name,
            item_key: task.items?.item_key,
            customer_name: task.items?.tickets?.customer_name,
            ticket_number: task.items?.tickets?.ticket_number,
            ticket_id: task.items?.tickets?.ticket_number || 'Unknown'
        }))
    },

    async getAccountTasks(filters = {}, page = 1, pageSize = 100) {
        const { data, error } = await supabase.rpc('get_account_tailor_paginated_tasks', {
            p_filter: filters.filter || 'pending',
            p_customer_search: filters.searchCustomer || null,
            p_ticket_search: filters.searchTicket || null,
            p_tailor_search: filters.searchTailor || null,
            p_task_name: filters.searchTask || null,
            p_category_name: filters.searchCategory || null,
            p_min_amount: filters.minAmount !== '' ? Number(filters.minAmount) || 0 : null,
            p_max_amount: filters.maxAmount !== '' ? Number(filters.maxAmount) || 0 : null,
            p_start_date: toDateBoundary(filters.dateFrom, 'start'),
            p_end_date: toDateBoundary(filters.dateTo, 'end'),
            p_page: page,
            p_page_size: pageSize
        })

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        const rows = data || []

        return {
            data: rows.map(row => row.task || {}).map(task => ({
                ...task,
                raw_status: task.status,
                status: normalizeAssignmentStatus(task.status),
                task_name: task.task_type_name,
                tailor_name: task.tailor_name,
                ticket_id: task.ticket_number || 'Unknown'
            })),
            count: Number(rows[0]?.total_tailors || 0)
        }
    },

    async verifyTask(taskId, status, reason = null) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_qc')

        let error;
        if (status === 'Approved' || status === 'QC_PASSED') {
            const result = await supabase.rpc('qc_pass', { p_assignment_id: taskId })
            error = result.error
        } else if (status === 'Rejected' || status === 'QC_FAILED') {
            const result = await supabase.rpc('qc_fail', { p_assignment_id: taskId, p_notes: reason })
            error = result.error
        } else {
            console.warn("Unknown verification status:", status);
            return null;
        }

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return { id: taskId, status: normalizeAssignmentStatus(status) }
    },

    async reverseTask(taskId, reason) {
        const ctx = await getContext()

        if (!ctx.permissions.includes('manage_payments') && !ctx.permissions.includes('admin')) {
            throw new PermissionDeniedError('Requires manage_payments or admin permission')
        }

        const trimmedReason = reason?.trim()

        if (!trimmedReason) {
            throw new Error('Reversal reason is required.')
        }

        const { data: assignment, error: fetchError } = await supabase
            .from('work_assignments')
            .select('*')
            .eq('id', taskId)
            .eq('organization_id', ctx.organizationId)
            .single()

        if (fetchError) {
            console.error(fetchError)
            throw new Error(fetchError.message)
        }

        if (!isApprovedStatus(assignment.status) && !isRejectedStatus(assignment.status)) {
            throw new Error(`Only approved or rejected tasks can be reversed. Current status: ${assignment.status}`)
        }

        const updatePayload = { status: 'CREATED' }

        if ('reversal_reason' in assignment) {
            updatePayload.reversal_reason = trimmedReason
        } else if ('reversal_notes' in assignment) {
            updatePayload.reversal_notes = trimmedReason
        } else if ('notes' in assignment) {
            const existingNotes = typeof assignment.notes === 'string' ? assignment.notes.trim() : ''
            updatePayload.notes = existingNotes
                ? `${existingNotes}\nReversal: ${trimmedReason}`
                : `Reversal: ${trimmedReason}`
        }

        const { error: updateError } = await supabase
            .from('work_assignments')
            .update(updatePayload)
            .eq('id', taskId)
            .eq('organization_id', ctx.organizationId)

        if (updateError) {
            console.error(updateError)
            throw new Error(updateError.message)
        }

        return { id: taskId, status: 'CREATED', reason: trimmedReason, reversed: true }
    },

    async reopenReversedTask(taskId) {
        const ctx = await getContext()

        if (!ctx.permissions.includes('manage_payments') && !ctx.permissions.includes('admin')) {
            throw new PermissionDeniedError('Requires manage_payments or admin permission')
        }

        const { data: assignment, error: fetchError } = await supabase
            .from('work_assignments')
            .select('id, status')
            .eq('id', taskId)
            .eq('organization_id', ctx.organizationId)
            .single()

        if (fetchError) {
            console.error(fetchError)
            throw new Error(fetchError.message)
        }

        if (assignment.status !== 'REVERSED') {
            return { id: taskId, status: assignment.status }
        }

        const { error: updateError } = await supabase
            .from('work_assignments')
            .update({ status: 'CREATED' })
            .eq('id', taskId)
            .eq('organization_id', ctx.organizationId)

        if (updateError) {
            console.error(updateError)
            throw new Error(updateError.message)
        }

        return { id: taskId, status: 'CREATED', reopened: true }
    },

    async updateItemStatus(itemId, status) {
    const ctx = await getContext()
    if (!ctx.permissions?.includes('manage_qc') && !ctx.permissions?.includes('manage_production')) {
        throw new Error('Permission denied: manage_qc or manage_production required')
    }

        const { data, error } = await supabase
            .from('items')
            .update({ status })
            .eq('id', itemId)
            .eq('organization_id', ctx.organizationId)
            .select()

        if (error) {
            console.error("Update error:", error)
            throw new Error(error.message)
        }

        // 🔴 This is the key check for RLS
        if (!data || data.length === 0) {
            console.warn("No rows updated — likely RLS blocking or wrong conditions")
            throw new Error("Update failed: no rows affected")
        }

        return data[0]
    },

    async updateItemReceivingStatus(itemId, isReceived) {
        const ctx = await getContext()
        if (!ctx.permissions?.includes('manage_completion')) {
            throw new Error('Permission denied: manage_completion required')
        }

        const { data, error } = await supabase
            .from('items')
            .update({
                is_received: isReceived,
                received_at: isReceived ? new Date().toISOString() : null
            })
            .eq('id', itemId)
            .eq('organization_id', ctx.organizationId)
            .select()

        if (error) {
            console.error("Receive update error:", error)
            throw new Error(error.message)
        }

        if (!data || data.length === 0) {
            throw new Error("Receive update failed: no rows affected")
        }

        return {
            ...data[0],
            raw_status: data[0].status,
            status: normalizeItemStatus(data[0].status),
            receiving_status: getReceivingStatus(data[0])
        }
    }
}
