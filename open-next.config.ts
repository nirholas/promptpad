import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// Every page reads live chain and registry data (force-dynamic), so there is no ISR output to cache.
export default defineCloudflareConfig({});
