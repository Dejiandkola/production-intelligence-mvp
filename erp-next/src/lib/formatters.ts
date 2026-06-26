type NumericValue = number | string | null | undefined

type MoneyFormatOptions = Intl.NumberFormatOptions & {
    currency?: string
}

function toNumber(value: NumericValue) {
    const normalized = typeof value === 'string' ? value.replace(/,/g, '') : value
    const amount = Number(normalized ?? 0)

    return Number.isFinite(amount) ? amount : 0
}

export function formatNumber(value: NumericValue, options: Intl.NumberFormatOptions = {}) {
    return toNumber(value).toLocaleString(undefined, {
        maximumFractionDigits: 0,
        ...options,
    })
}

export function formatMoney(value: NumericValue, options: MoneyFormatOptions = {}) {
    const {
        currency = 'NGN',
        minimumFractionDigits = 2,
        maximumFractionDigits = 2,
        ...numberOptions
    } = options

    return `${currency} ${formatNumber(value, {
        minimumFractionDigits,
        maximumFractionDigits,
        ...numberOptions,
    })}`
}
