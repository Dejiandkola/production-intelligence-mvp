import { createClient } from '@/lib/supabase/client'

const supabase = createClient()

let contextCache = null
let contextCacheTime = 0
const CONTEXT_TTL_MS = 60 * 1000

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

        const { data, error } = await supabase
            .from('items')
            .select(`
                *,
                tickets(ticket_number, customer_name),
                product_types(name),
                work_assignments(category_types(name))
            `)
            .eq('organization_id', ctx.organizationId)
            .order('created_at', { ascending: false })

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        // Map foreign relations to expected UI names
        return data.map(item => ({
            ...item,
            ticket_number: item.tickets?.ticket_number,
            customer_name: item.tickets?.customer_name,
            product_type_name: item.product_types?.name
        }))
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
            task_type_name: task.task_types?.name,
            tailor_name: task.tailors?.name,
            category_name: task.category_types?.name
        }))
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

    async getWeeklyPayroll(startDate, endDate) {
        const ctx = await getContext()

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

        if (startDate) {
            query = query.gte('updated_at', `${startDate}T00:00:00`)
        }
        if (endDate) {
            query = query.lte('updated_at', `${endDate}T23:59:59`)
        }

        const { data, error } = await query

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        const payrollMap = {}

        for (const wa of (data || [])) {
            const tailorId = wa.tailor_id
            const tailor = wa.tailors

            if (!payrollMap[tailorId]) {
                payrollMap[tailorId] = {
                    tailor_id: tailorId,
                    tailor_name: tailor?.name || 'Unknown',
                    department: tailor?.department || 'Production',
                    weekly_verified_total: 0,
                    weekly_total_pay: 0,
                    task_count: 0
                }
            }

            const pay = Number(wa.pay_amount || 0)

            payrollMap[tailorId].weekly_verified_total += pay
            payrollMap[tailorId].weekly_total_pay += pay
            payrollMap[tailorId].task_count += 1
        }

        const finalPayroll = Object.values(payrollMap)
        return finalPayroll
    },

    async createWorkAssignment(payload) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_production')

        const { data, error } = await supabase.rpc('update_work_assignment', {
            p_assignment_id: id,
            p_category_type_id: payload.category_type_id,
            p_task_type_id: payload.task_type_id,
            p_tailor_id: payload.tailor_id,
        })

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        // Update item status to IN_QC when a task is assigned
        await this.updateItemStatus(payload.item_id, 'IN_QC');

        return data
    },

    async deleteWorkAssignment(id) {
        const ctx = await getContext()
        requirePermission(ctx, 'manage_production')

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

        if (assignment.status === 'QC_PASSED' || assignment.status === 'PAID' || assignment.status === 'REVERSED') {
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
        requirePermission(ctx, 'manage_production')

        // 1. Fetch assignment and confirm it exists, same org
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

        // 2. Editing Rules
        if (assignment.status === 'QC_PASSED' || assignment.status === 'PAID' || assignment.status === 'REVERSED') {
            throw new Error("Cannot edit this task because it has already progressed beyond assignment.")
        }

        if (assignment.status !== 'CREATED') {
            throw new Error(`Cannot edit this task. Current status: ${assignment.status}`)
        }

        // 3. Extract ONLY permitted fields
        const allowedPayload = {
            p_assignment_id: id,
            p_category_type_id: payload.category_type_id,
            p_task_type_id: payload.task_type_id,
            p_tailor_id: payload.tailor_id
        }

        if (!allowedPayload.p_category_type_id || !allowedPayload.p_task_type_id || !allowedPayload.p_tailor_id) {
            throw new Error("Missing required editable fields: category, task, or tailor.")
        }

        // 4. Update via RPC to reuse identical pricing snapshot logic
        const { data, error } = await supabase.rpc('update_work_assignment', allowedPayload)

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data
    },

    async getTasks() {
        const ctx = await getContext()

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

        if (error) {
            console.error(error)
            throw new Error(error.message)
        }

        return data.map(task => ({
            ...task,
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

        return { id: taskId, status }
    },

    async updateItemStatus(itemId, status) {
        const ctx = await getContext()

        // 🔴 Enforce correct permission for completion
        if (!ctx.permissions?.includes('manage_completion')) {
            throw new Error('Permission denied: manage_completion required')
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
    }
}
