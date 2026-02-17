#!/usr/bin/env node
/**
 * Outpost Publishing Cron
 * 
 * Runs every 15 minutes. Checks content_queue for approved items with
 * scheduled_at <= NOW() that haven't been published, and publishes them
 * via the Late.dev API.
 * 
 * Usage: node scripts/publish-cron.js
 * 
 * Environment:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY  (or uses defaults below)
 *   LATE_API_KEY                         (or uses default below)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://xijsvdhffiuxpepswnyb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpanN2ZGhmZml1eHBlcHN3bnliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNzU0NTYsImV4cCI6MjA4MTc1MTQ1Nn0.Y5igqaP-p4ZvvVP47xvy4SFCyZE030wyuITYIUwWlRI';
const LATE_API_KEY = process.env.LATE_API_KEY || 'sk_3ed3280b01d01d6fee8b5e9d59ea12cafe752e08a64fc973aa1db38c4a0c7f85';
const LATE_BASE_URL = 'https://getlate.dev/api/v1';
const PROFILE_ID = '698a02f37e05c2e7eda639c5';

// Late.dev account IDs (from /v1/accounts)
const LATE_ACCOUNTS = {
  instagram: '698a719b4525118cee8a96d9',
  tiktok: '698a72e94525118cee8a9777',
  twitter: '698a71e54525118cee8a9706',
};

async function supabaseFetch(path, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  return res.json();
}

async function lateFetch(path, options = {}) {
  const url = `${LATE_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${LATE_API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Late.dev ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function publishToLate(item) {
  // Map platform to Late.dev account ID
  const accountId = item.publish_channel || LATE_ACCOUNTS[item.platform];
  if (!accountId) {
    throw new Error(`No Late.dev account for platform: ${item.platform}`);
  }

  const postData = {
    content: item.body,
    platforms: [{
      platform: item.platform,
      accountId: accountId,
    }],
    publishNow: true,
    timezone: 'America/Chicago',
  };

  // Add title for platforms that support it
  if (item.title && ['youtube', 'reddit'].includes(item.platform)) {
    postData.title = item.title;
  }

  // Add media if present
  if (item.media_urls && item.media_urls.length > 0) {
    postData.mediaItems = item.media_urls.map(url => ({ url }));
  }

  const result = await lateFetch('/posts', {
    method: 'POST',
    body: JSON.stringify(postData),
  });

  return result;
}

async function run() {
  console.log(`[${new Date().toISOString()}] Outpost publish cron starting...`);

  // Find approved items with scheduled_at <= NOW() that aren't published
  const now = new Date().toISOString();
  const items = await supabaseFetch(
    `content_queue?status=in.(approved,scheduled)&scheduled_at=lte.${now}&published_at=is.null&order=scheduled_at.asc&limit=10`
  );

  if (items.length === 0) {
    console.log('No items due for publishing.');
    return;
  }

  console.log(`Found ${items.length} items to publish.`);

  for (const item of items) {
    console.log(`Publishing: [${item.platform}] ${item.title || item.id}`);
    try {
      const result = await publishToLate(item);
      const postId = result.post?._id || result._id || null;
      const postUrl = result.post?.platforms?.[0]?.platformPostUrl || null;

      // Update as published
      await supabaseFetch(`content_queue?id=eq.${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'published',
          published_at: new Date().toISOString(),
          external_post_id: postId,
          published_url: postUrl,
          updated_at: new Date().toISOString(),
          error_message: null,
        }),
      });
      console.log(`  ✅ Published successfully. Post ID: ${postId}`);
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}`);
      // Update retry count and error
      const retryCount = (item.retry_count || 0) + 1;
      const updates = {
        retry_count: retryCount,
        error_message: err.message,
        updated_at: new Date().toISOString(),
      };
      // After 3 retries, mark as failed
      if (retryCount >= 3) {
        updates.status = 'failed';
        console.log(`  ⚠️ Max retries reached, marking as failed.`);
      }
      await supabaseFetch(`content_queue?id=eq.${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
    }
  }

  console.log('Publish cron complete.');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
