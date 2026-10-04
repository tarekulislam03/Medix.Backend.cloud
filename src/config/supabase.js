import { createClient } from "@supabase/supabase-js";

export const getSupabaseClients = () => {
  const configs = [];
  const registeredUrls = new Set();

  // 1. Primary Supabase
  const primaryUrl = process.env.VITE_SUPABASE_URL;
  const primaryKey = process.env.VITE_SUPABASE_ANON_KEY;

  if (primaryUrl && primaryKey) {
    configs.push({
      name: "supabase_primary",
      url: primaryUrl,
      client: createClient(primaryUrl, primaryKey)
    });
    registeredUrls.add(primaryUrl);
  }

  // 2. Secondary Supabase (explicit common aliases)
  const secondaryUrl =
    process.env.VITE_SUPABASE_URL;


  const secondaryKey =
    process.env.VITE_SUPABASE_ANON_KEY;

  if (secondaryUrl && secondaryKey && !registeredUrls.has(secondaryUrl)) {
    configs.push({
      name: "supabase_secondary",
      url: secondaryUrl,
      client: createClient(secondaryUrl, secondaryKey)
    });
    registeredUrls.add(secondaryUrl);
  }

  // 3. Scan for any other custom SUPABASE_*_URL in process.env
  for (const [key, value] of Object.entries(process.env)) {
    if (key.includes("SUPABASE") && key.endsWith("_URL") && value && !registeredUrls.has(value)) {
      const basePrefix = key.replace(/_URL$/, "");
      const matchedKey =
        process.env[`${basePrefix}_SERVICE_ROLE_KEY`] ||
        process.env[`${basePrefix}_KEY`] ||
        process.env[`${basePrefix}_ANON_KEY`];

      if (matchedKey) {
        configs.push({
          name: basePrefix.toLowerCase(),
          url: value,
          client: createClient(value, matchedKey)
        });
        registeredUrls.add(value);
      }
    }
  }

  return configs;
};
