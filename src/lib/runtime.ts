/** True inside Cloudflare's workerd runtime (the production Workers deployment). */
export const onWorkers = typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
