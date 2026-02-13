    // Supabase Configuration
    const SUPABASE_URL = 'https://xijsvdhffiuxpepswnyb.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhpanN2ZGhmZml1eHBlcHN3bnliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNzU0NTYsImV4cCI6MjA4MTc1MTQ1Nn0.Y5igqaP-p4ZvvVP47xvy4SFCyZE030wyuITYIUwWlRI';
    
    let supabase;
    let aviScoreChart;
    let currentTaskFilter = 'open'; // 'open', 'completed', or 'all'
    let allTasks = []; // Cache for task filtering

    // Initialize
    async function init() {
      console.log('[Dashboard] init() starting...');
      try {
        console.log('[Dashboard] Creating Supabase client...');
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('[Dashboard] Supabase client created');
        
        document.getElementById('connectionStatus').innerHTML = 
          '<span class="text-green-400">✅ Connected to Supabase</span>';
        document.getElementById('connectionStatus').className = 
          'mb-6 p-4 bg-green-900/50 border border-green-600 rounded-lg';
        
        // Test connection first
        console.log('[Dashboard] Testing connection...');
        const { data, error: testError } = await supabase
          .from('canonical_products')
          .select('id')
          .limit(1);
        
        console.log('[Dashboard] Test result:', { data, error: testError });
        
        if (testError) {
          throw new Error(`Supabase error: ${testError.message}`);
        }
        
        document.getElementById('connectionStatus').innerHTML = 
          '<span class="text-green-400">✅ Connected to Supabase</span>';
        document.getElementById('connectionStatus').className = 
          'mb-6 p-4 bg-green-900/50 border border-green-600 rounded-lg';
        
        console.log('[Dashboard] Calling refreshAll...');
        await refreshAll();
        console.log('[Dashboard] init() complete');
      } catch (error) {
        console.error('[Dashboard] Connection error:', error);
        document.getElementById('connectionStatus').innerHTML = 
          `<span class="text-red-400">❌ Connection failed: ${error.message}</span>`;
        document.getElementById('connectionStatus').className = 
          'mb-6 p-4 bg-red-900/50 border border-red-600 rounded-lg';
      }
    }
    
    // Expose for debugging
    window.dashboardInit = init;

    async function refreshAll() {
      document.getElementById('lastRefresh').textContent = new Date().toLocaleTimeString();
      
      await Promise.all([
        loadOverviewMetrics(),
        loadCoverageMetrics(),
        loadCertificationCoverage(),
        loadTopBrands(),
        loadDataGaps(),
        loadRecentActivity()
      ]);
    }

    // Load Overview Metrics
    async function loadOverviewMetrics() {
      try {
        // Total canonical products
        const { count: productCount } = await supabase
          .from('canonical_products')
          .select('*', { count: 'exact', head: true });
        document.getElementById('totalProducts').textContent = productCount?.toLocaleString() || '0';
        document.getElementById('totalProducts').classList.remove('loading');

        // Total sources
        const { count: sourceCount } = await supabase
          .from('product_sources')
          .select('*', { count: 'exact', head: true });
        document.getElementById('totalSources').textContent = sourceCount?.toLocaleString() || '0';
        document.getElementById('totalSources').classList.remove('loading');

        // Unique brands (use RPC to avoid row limit issue)
        const { data: brandCount } = await supabase.rpc('get_unique_brand_count');
        document.getElementById('totalBrands').textContent = (brandCount || 0).toLocaleString();
        document.getElementById('totalBrands').classList.remove('loading');

        // GVM Fleet Status
        await loadFleetStatus();

      } catch (error) {
        console.error('Error loading overview:', error);
      }
    }

    // ─── GVM Fleet Status ───
    let fleetPanelOpen = false;
    let fleetRefreshTimer = null;

    window.toggleFleetPanel = toggleFleetPanel;
    function toggleFleetPanel() {
      fleetPanelOpen = !fleetPanelOpen;
      document.getElementById('fleetPanel').classList.toggle('hidden', !fleetPanelOpen);
      if (fleetPanelOpen && !fleetRefreshTimer) {
        fleetRefreshTimer = setInterval(loadFleetStatus, 15 * 60 * 1000); // 15 min
      }
    }

    async function loadFleetStatus() {
      try {
        const { data: vms, error } = await supabase
          .from('gvm_fleet_status')
          .select('*')
          .order('vm_name');

        if (error || !vms?.length) {
          document.getElementById('fleetTotalProducts').textContent = '0';
          document.getElementById('fleetTotalProducts').classList.remove('loading');
          return;
        }

        const totalScraped = vms.reduce((s, v) => s + (v.products_scraped || 0), 0);
        const totalImages = vms.reduce((s, v) => s + (v.images_downloaded || 0), 0);
        const totalErrors = vms.reduce((s, v) => s + (v.errors || 0), 0);
        const runningCount = vms.filter(v => v.status === 'running').length;

        // Summary card
        document.getElementById('fleetTotalProducts').textContent = totalScraped.toLocaleString();
        document.getElementById('fleetTotalProducts').classList.remove('loading');

        const statusColors = { running: 'text-green-400', stopped: 'text-gray-400', error: 'text-red-400', complete: 'text-blue-400', unknown: 'text-yellow-400' };
        const statusIcons = { running: '🟢', stopped: '⏹️', error: '🔴', complete: '✅', unknown: '🟡' };

        // Mini summary under the number
        document.getElementById('fleetVmSummary').innerHTML = vms.map(v =>
          `<span class="${statusColors[v.status] || 'text-gray-500'}">${statusIcons[v.status] || '?'} ${v.vm_name.replace('amazon-', '')}: ${(v.products_scraped || 0)}</span>`
        ).join(' · ');

        // Last update time
        const newest = vms.reduce((a, b) => new Date(a.updated_at) > new Date(b.updated_at) ? a : b);
        const ago = Math.round((Date.now() - new Date(newest.updated_at).getTime()) / 60000);
        document.getElementById('fleetLastUpdate').textContent = ago < 1 ? 'just now' : `${ago}m ago`;

        // Expanded panel cards
        const grid = document.getElementById('fleetGrid');
        grid.innerHTML = vms.map(v => {
          const pct = v.search_list_size > 0 ? Math.round((v.products_scraped || 0) / v.search_list_size * 100) : 0;
          const statusColor = { running: 'border-green-500/50', stopped: 'border-gray-600', error: 'border-red-500/50', complete: 'border-blue-500/50' }[v.status] || 'border-gray-600';
          return `
            <div class="bg-gray-800 rounded-lg p-4 border ${statusColor}">
              <div class="flex items-center justify-between mb-2">
                <span class="font-semibold text-sm text-white">${v.vm_name}</span>
                <span class="text-xs px-2 py-0.5 rounded ${v.status === 'running' ? 'bg-green-500/20 text-green-400' : v.status === 'complete' ? 'bg-blue-500/20 text-blue-400' : v.status === 'error' ? 'bg-red-500/20 text-red-400' : 'bg-gray-600/20 text-gray-400'}">${v.status}</span>
              </div>
              <div class="text-xs text-purple-400 mb-3">${v.brand || 'N/A'}</div>
              <div class="space-y-1 text-xs">
                <div class="flex justify-between"><span class="text-gray-400">Products</span><span class="text-white font-mono">${(v.products_scraped || 0).toLocaleString()} / ${(v.search_list_size || 0).toLocaleString()}</span></div>
                <div class="flex justify-between"><span class="text-gray-400">Images</span><span class="text-white font-mono">${(v.images_downloaded || 0).toLocaleString()}</span></div>
                <div class="flex justify-between"><span class="text-gray-400">Errors</span><span class="text-white font-mono ${(v.errors || 0) > 0 ? 'text-red-400' : ''}">${v.errors || 0}</span></div>
                <div class="flex justify-between"><span class="text-gray-400">Skipped</span><span class="text-white font-mono">${v.skipped || 0}</span></div>
                <div class="flex justify-between"><span class="text-gray-400">Elapsed</span><span class="text-white font-mono">${v.elapsed || '--'}</span></div>
              </div>
              <div class="mt-3">
                <div class="w-full bg-gray-700 rounded-full h-1.5">
                  <div class="bg-green-500 h-1.5 rounded-full transition-all" style="width: ${Math.min(pct, 100)}%"></div>
                </div>
                <div class="text-right text-[10px] text-gray-500 mt-1">${pct}%</div>
              </div>
              ${v.last_product_title ? `<div class="mt-2 text-[10px] text-gray-500 truncate" title="${v.last_product_title}">Last: ${v.last_product_title}</div>` : ''}
            </div>`;
        }).join('');

      } catch (error) {
        console.error('Error loading fleet status:', error);
        document.getElementById('fleetTotalProducts').textContent = '--';
        document.getElementById('fleetTotalProducts').classList.remove('loading');
      }
    }

    // Load Coverage Metrics
    async function loadCoverageMetrics() {
      try {
        const { count: total } = await supabase
          .from('canonical_products')
          .select('*', { count: 'exact', head: true });

        const coverageFields = [
          { name: 'UPC Barcode', column: 'upc' },
          { name: 'Supplement Facts', column: 'supplement_facts' },
          { name: 'Front Label Image', column: 'front_label_url' },
          { name: 'Back Label Image', column: 'back_label_url' },
          { name: 'Certifications', column: 'certifications' },
          { name: 'Dosage Form', column: 'dosage_form' }
        ];

        let html = '';
        for (const field of coverageFields) {
          const { count } = await supabase
            .from('canonical_products')
            .select('*', { count: 'exact', head: true })
            .not(field.column, 'is', null);
          
          const percent = total > 0 ? Math.round((count / total) * 100) : 0;
          const color = percent >= 80 ? 'green' : percent >= 50 ? 'yellow' : 'red';
          
          html += `
            <div>
              <div class="flex justify-between text-sm mb-1">
                <span>${field.name}</span>
                <span class="text-${color}-400">${percent}%</span>
              </div>
              <div class="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full bg-${color}-500 progress-bar" style="width: ${percent}%"></div>
              </div>
            </div>
          `;
        }

        document.getElementById('coverageMetrics').innerHTML = html;

        // AviScore distribution
        await loadAviScoreChart(total);

      } catch (error) {
        console.error('Error loading coverage:', error);
        document.getElementById('coverageMetrics').innerHTML = 
          `<div class="text-red-400">Error loading data</div>`;
      }
    }

    // Load AviScore Chart
    async function loadAviScoreChart(total) {
      try {
        // Use server-side aggregation to avoid row limit issues
        const { data: distribution } = await supabase.rpc('get_aviscore_distribution');
        
        const grades = distribution || { A: 0, B: 0, C: 0, D: 0, F: 0, 'No Score': 0 };

        const ctx = document.getElementById('aviScoreCanvas').getContext('2d');
        
        if (aviScoreChart) aviScoreChart.destroy();
        
        aviScoreChart = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: ['A (8-10)', 'B (6-8)', 'C (4-6)', 'D (2-4)', 'F (0-2)', 'No Score'],
            datasets: [{
              data: [grades.A, grades.B, grades.C, grades.D, grades.F, grades['No Score']],
              backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#ef4444', '#4b5563'],
              borderWidth: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { 
                display: true, 
                position: 'right',
                labels: { color: '#9ca3af', font: { size: 10 } }
              }
            }
          }
        });

        document.getElementById('aviScoreStats').innerHTML = 
          `${count?.toLocaleString() || 0} products scored (${Math.round((count/total)*100)}%)`;
        document.getElementById('aviScoreStats').classList.remove('loading');

      } catch (error) {
        console.error('Error loading AviScore chart:', error);
      }
    }

    // Load Certification Coverage
    async function loadCertificationCoverage() {
      try {
        const { count: total } = await supabase
          .from('product_quality_scores')
          .select('*', { count: 'exact', head: true });

        const certs = [
          { name: 'Third Party Tested', column: 'third_party_tested', icon: '🔬' },
          { name: 'NSF Certified', column: 'nsf_certified', icon: '✅' },
          { name: 'USP Verified', column: 'usp_verified', icon: '🏆' },
          { name: 'NSF Sport', column: 'nsf_certified_for_sport', icon: '🏭' },
          { name: 'Non-GMO', column: 'certified_non_gmo', icon: '🌱' },
          { name: 'Organic', column: 'usda_organic', icon: '🌿' },
          { name: 'Vegan', column: 'certified_vegan', icon: '🥬' },
          { name: 'Gluten Free', column: 'certified_gluten_free', icon: '🌾' }
        ];

        let html = '';
        for (const cert of certs) {
          const { count } = await supabase
            .from('product_quality_scores')
            .select('*', { count: 'exact', head: true })
            .eq(cert.column, true);
          
          const percent = total > 0 ? Math.round((count / total) * 100) : 0;
          
          html += `
            <div class="bg-gray-700/50 rounded p-3">
              <div class="text-lg">${cert.icon}</div>
              <div class="text-sm font-semibold truncate">${cert.name}</div>
              <div class="text-xl font-bold">${count?.toLocaleString() || 0}</div>
              <div class="text-xs text-gray-400">${percent}%</div>
            </div>
          `;
        }

        document.getElementById('certificationGrid').innerHTML = html;

      } catch (error) {
        console.error('Error loading certifications:', error);
      }
    }

    // Load Top Brands with Metrics
    async function loadTopBrands() {
      try {
        // Fetch products with brand and scoring data - paginate to get all
        let allProducts = [];
        let offset = 0;
        const batchSize = 1000;
        
        while (true) {
          const { data } = await supabase
            .from('canonical_products')
            .select('id, brand, routing_metadata, supplement_facts, front_label_url, upc')
            .not('brand', 'is', null)
            .range(offset, offset + batchSize - 1);
          
          if (!data || data.length === 0) break;
          allProducts = allProducts.concat(data);
          if (data.length < batchSize) break;
          offset += batchSize;
        }

        // Fetch quality scores for certification data
        const productIds = allProducts.map(p => p.id);
        let qualityScores = {};
        
        // Fetch in batches of 500 (query param limits)
        for (let i = 0; i < productIds.length; i += 500) {
          const batchIds = productIds.slice(i, i + 500);
          const { data: scores } = await supabase
            .from('product_quality_scores')
            .select('product_id, third_party_tested, nsf_certified, usp_verified')
            .in('product_id', batchIds);
          
          scores?.forEach(s => {
            qualityScores[s.product_id] = s;
          });
        }

        // Aggregate by brand
        const brandStats = {};
        allProducts.forEach(p => {
          if (!p.brand) return;
          
          if (!brandStats[p.brand]) {
            brandStats[p.brand] = {
              count: 0,
              scores: [],
              hasSupplementFacts: 0,
              hasFrontLabel: 0,
              hasUpc: 0,
              thirdPartyTested: 0,
              nsfCertified: 0,
              uspVerified: 0
            };
          }
          
          const stats = brandStats[p.brand];
          stats.count++;
          
          const aviScore = p.routing_metadata?.avi_score?.score;
          if (aviScore !== undefined && aviScore !== null) {
            stats.scores.push(aviScore);
          }
          
          if (p.supplement_facts) stats.hasSupplementFacts++;
          if (p.front_label_url) stats.hasFrontLabel++;
          if (p.upc) stats.hasUpc++;
          
          const quality = qualityScores[p.id];
          if (quality) {
            if (quality.third_party_tested) stats.thirdPartyTested++;
            if (quality.nsf_certified) stats.nsfCertified++;
            if (quality.usp_verified) stats.uspVerified++;
          }
        });

        // Calculate averages and sort by count
        const sorted = Object.entries(brandStats)
          .map(([brand, stats]) => ({
            brand,
            count: stats.count,
            avgScore: stats.scores.length > 0 
              ? (stats.scores.reduce((a, b) => a + b, 0) / stats.scores.length).toFixed(1) 
              : null,
            scoredPct: Math.round((stats.scores.length / stats.count) * 100),
            factsPct: Math.round((stats.hasSupplementFacts / stats.count) * 100),
            labelPct: Math.round((stats.hasFrontLabel / stats.count) * 100),
            thirdPartyPct: Math.round((stats.thirdPartyTested / stats.count) * 100),
            certCount: stats.nsfCertified + stats.uspVerified
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 15);

        // Generate table HTML
        const getScoreColor = (score) => {
          if (score === null) return 'gray';
          if (score >= 8) return 'green';
          if (score >= 6) return 'blue';
          if (score >= 4) return 'yellow';
          return 'red';
        };

        const getPctColor = (pct) => {
          if (pct >= 80) return 'green';
          if (pct >= 50) return 'yellow';
          return 'red';
        };

        let html = `
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-gray-400 border-b border-gray-600">
                  <th class="pb-2 pr-2">#</th>
                  <th class="pb-2 pr-4">Brand</th>
                  <th class="pb-2 pr-3 text-center">Products</th>
                  <th class="pb-2 pr-3 text-center">Avg Score</th>
                  <th class="pb-2 pr-3 text-center">3rd Party</th>
                  <th class="pb-2 pr-3 text-center">Facts</th>
                  <th class="pb-2 text-center">Labels</th>
                </tr>
              </thead>
              <tbody>
        `;

        sorted.forEach((b, i) => {
          const scoreColor = getScoreColor(b.avgScore ? parseFloat(b.avgScore) : null);
          html += `
            <tr class="border-b border-gray-700/50 hover:bg-gray-700/30">
              <td class="py-2 pr-2 text-gray-500">${i + 1}</td>
              <td class="py-2 pr-4 font-medium truncate max-w-[140px]" title="${b.brand}">${b.brand}</td>
              <td class="py-2 pr-3 text-center text-purple-400 font-bold">${b.count}</td>
              <td class="py-2 pr-3 text-center">
                ${b.avgScore 
                  ? `<span class="text-${scoreColor}-400 font-bold">${b.avgScore}</span>` 
                  : '<span class="text-gray-500">—</span>'}
              </td>
              <td class="py-2 pr-3 text-center">
                <span class="text-${getPctColor(b.thirdPartyPct)}-400">${b.thirdPartyPct}%</span>
              </td>
              <td class="py-2 pr-3 text-center">
                <span class="text-${getPctColor(b.factsPct)}-400">${b.factsPct}%</span>
              </td>
              <td class="py-2 text-center">
                <span class="text-${getPctColor(b.labelPct)}-400">${b.labelPct}%</span>
              </td>
            </tr>
          `;
        });

        html += '</tbody></table></div>';

        document.getElementById('topBrands').innerHTML = html;

      } catch (error) {
        console.error('Error loading brands:', error);
        document.getElementById('topBrands').innerHTML = 
          `<div class="text-red-400">Error loading brand metrics</div>`;
      }
    }

    // Data gap metrics configuration
    const DATA_GAP_METRICS = [
      { key: 'missing_upc', label: 'Missing UPC', color: '#ef4444' },
      { key: 'missing_facts', label: 'Missing Supplement Facts', color: '#f97316' },
      { key: 'missing_front_label', label: 'Missing Front Label', color: '#eab308' },
      { key: 'missing_back_label', label: 'Missing Back Label', color: '#a855f7' },
      { key: 'missing_aviscore', label: 'Missing AviScore', color: '#3b82f6' },
      { key: 'unmatched_discovered', label: 'Unmatched Products', color: '#8b5cf6' }
    ];

    let dataGapsChart = null;

    // Capture current metrics snapshot
    async function captureMetricsSnapshot() {
      try {
        const metrics = await getCurrentMetrics();
        const now = new Date().toISOString();
        
        // Check if we already have a snapshot today
        const today = now.split('T')[0];
        const { data: existing } = await supabase
          .from('metrics_history')
          .select('id')
          .gte('captured_at', today)
          .lt('captured_at', today + 'T23:59:59')
          .limit(1);
        
        if (existing && existing.length > 0) {
          console.log('[Metrics] Snapshot already exists for today, skipping');
          return metrics;
        }

        // Insert new metrics
        const inserts = Object.entries(metrics).map(([key, value]) => ({
          captured_at: now,
          metric_name: key,
          metric_value: value
        }));

        const { error } = await supabase
          .from('metrics_history')
          .insert(inserts);

        if (error) {
          console.error('[Metrics] Failed to save snapshot:', error);
        } else {
          console.log('[Metrics] Snapshot captured:', metrics);
        }

        return metrics;
      } catch (error) {
        console.error('[Metrics] Error capturing snapshot:', error);
        return null;
      }
    }

    // Get current gap metrics
    async function getCurrentMetrics() {
      const { count: noUpc } = await supabase
        .from('canonical_products')
        .select('*', { count: 'exact', head: true })
        .is('upc', null);

      const { count: noFacts } = await supabase
        .from('canonical_products')
        .select('*', { count: 'exact', head: true })
        .is('supplement_facts', null);

      const { count: noFront } = await supabase
        .from('canonical_products')
        .select('*', { count: 'exact', head: true })
        .is('front_label_url', null);

      const { count: noBack } = await supabase
        .from('canonical_products')
        .select('*', { count: 'exact', head: true })
        .is('back_label_url', null);

      const { count: noScore } = await supabase
        .from('canonical_products')
        .select('*', { count: 'exact', head: true })
        .is('routing_metadata->avi_score', null);

      const { count: unmatched } = await supabase
        .from('discovered_products')
        .select('*', { count: 'exact', head: true })
        .eq('match_status', 'unmatched');

      return {
        missing_upc: noUpc || 0,
        missing_facts: noFacts || 0,
        missing_front_label: noFront || 0,
        missing_back_label: noBack || 0,
        missing_aviscore: noScore || 0,
        unmatched_discovered: unmatched || 0
      };
    }

    // Load historical metrics
    async function loadMetricsHistory() {
      // Paginate to avoid Supabase row limits (default 1000)
      let allData = [];
      let offset = 0;
      const batchSize = 1000;
      
      while (true) {
        const { data } = await supabase
          .from('metrics_history')
          .select('captured_at, metric_name, metric_value')
          .order('captured_at', { ascending: true })
          .range(offset, offset + batchSize - 1);
        
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        if (data.length < batchSize) break;
        offset += batchSize;
      }
      
      const data = allData;

      // Group by date
      const byDate = {};
      data?.forEach(row => {
        const date = row.captured_at.split('T')[0];
        if (!byDate[date]) byDate[date] = {};
        byDate[date][row.metric_name] = row.metric_value;
      });

      return byDate;
    }

    // Load Data Gaps with Trend Chart
    async function loadDataGaps() {
      try {
        // Capture today's snapshot first
        const currentMetrics = await captureMetricsSnapshot() || await getCurrentMetrics();

        // Load historical data
        const history = await loadMetricsHistory();
        const dates = Object.keys(history).sort();

        // Always use live values for today (overwrite any stale historical data)
        const today = new Date().toISOString().split('T')[0];
        if (!history[today]) {
          dates.push(today);
        }
        history[today] = currentMetrics;

        // Build chart datasets
        const datasets = DATA_GAP_METRICS.map(metric => ({
          label: metric.label,
          data: dates.map(d => history[d]?.[metric.key] ?? null),
          borderColor: metric.color,
          backgroundColor: metric.color + '20',
          tension: 0.3,
          fill: false,
          pointRadius: 3,
          pointHoverRadius: 5
        }));

        // Render chart
        const ctx = document.getElementById('dataGapsCanvas').getContext('2d');
        
        if (dataGapsChart) dataGapsChart.destroy();

        dataGapsChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: dates.map(d => {
              const dt = new Date(d);
              return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            }),
            datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
              mode: 'index',
              intersect: false
            },
            plugins: {
              legend: {
                position: 'bottom',
                labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12, padding: 15 }
              },
              tooltip: {
                backgroundColor: '#1f2937',
                titleColor: '#fff',
                bodyColor: '#9ca3af',
                borderColor: '#374151',
                borderWidth: 1,
                position: 'nearest',
                xAlign: 'center',
                yAlign: 'bottom',
                caretSize: 6
              }
            },
            scales: {
              x: {
                ticks: { color: '#6b7280', font: { size: 10 } },
                grid: { color: '#374151' }
              },
              y: {
                ticks: { color: '#6b7280', font: { size: 10 } },
                grid: { color: '#374151' },
                beginAtZero: true
              }
            }
          }
        });

        // Show current values below chart
        let currentHtml = `
          <div class="grid grid-cols-2 md:grid-cols-6 gap-2 mt-4 pt-4 border-t border-gray-700">
            ${DATA_GAP_METRICS.map(m => `
              <div class="text-center">
                <div class="text-xs text-gray-400">${m.label}</div>
                <div class="text-lg font-bold" style="color: ${m.color}">${currentMetrics[m.key]?.toLocaleString() || 0}</div>
              </div>
            `).join('')}
          </div>
        `;
        document.getElementById('dataGapsCurrentValues').innerHTML = currentHtml;

        // Enrichment queue (keep simple list)
        document.getElementById('enrichmentQueue').innerHTML = `
          <div class="flex justify-between items-center p-2 bg-gray-700/50 rounded">
            <span class="text-sm">Products missing front label</span>
            <span class="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs font-bold">${currentMetrics.missing_front_label?.toLocaleString() || 0}</span>
          </div>
          <div class="flex justify-between items-center p-2 bg-gray-700/50 rounded">
            <span class="text-sm">Products missing back label</span>
            <span class="px-2 py-1 bg-purple-500/20 text-purple-400 rounded text-xs font-bold">${currentMetrics.missing_back_label?.toLocaleString() || 0}</span>
          </div>
          <div class="flex justify-between items-center p-2 bg-gray-700/50 rounded">
            <span class="text-sm">Products needing AviScore</span>
            <span class="px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded text-xs font-bold">${currentMetrics.missing_aviscore?.toLocaleString() || 0}</span>
          </div>
          <div class="flex justify-between items-center p-2 bg-gray-700/50 rounded">
            <span class="text-sm">Registry products to match</span>
            <span class="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-xs font-bold">${currentMetrics.unmatched_discovered?.toLocaleString() || 0}</span>
          </div>
        `;

      } catch (error) {
        console.error('Error loading gaps:', error);
        document.getElementById('dataGapsChart').innerHTML = 
          `<div class="text-red-400">Error loading data gap trends</div>`;
      }
    }

    // Load Recent Activity
    async function loadRecentActivity() {
      try {
        const { data: recent } = await supabase
          .from('canonical_products')
          .select('canonical_name, brand, created_at')
          .order('created_at', { ascending: false })
          .limit(10);

        let html = recent?.map(p => `
          <div class="flex justify-between items-center p-2 bg-gray-700/30 rounded">
            <span class="text-gray-300 truncate flex-1">${p.brand} - ${p.canonical_name}</span>
            <span class="text-gray-500 text-xs ml-2">${new Date(p.created_at).toLocaleDateString()}</span>
          </div>
        `).join('') || '<div class="text-gray-400">No recent activity</div>';

        document.getElementById('recentActivity').innerHTML = html;

      } catch (error) {
        console.error('Error loading activity:', error);
      }
    }

    // ==================== TASK QUEUE FUNCTIONS ====================
    
    // ==================== ONGOING TASKS (Background Processes) ====================
    
    // Load ongoing tasks
    async function loadOngoingTasks() {
      try {
        const { data: tasks, error } = await supabase
          .from('ongoing_tasks')
          .select('*')
          .order('created_at', { ascending: true });
        
        if (error) throw error;
        renderOngoingTasks(tasks || []);
      } catch (error) {
        console.error('Error loading ongoing tasks:', error);
      }
    }
    
    // Render ongoing tasks UI
    function renderOngoingTasks(tasks) {
      const container = document.getElementById('ongoingTasksContainer');
      if (!container) return;
      
      if (tasks.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-sm">No ongoing tasks configured.</div>';
        return;
      }
      
      const statusColors = {
        running: { bg: 'green', text: 'green', icon: '▶️' },
        paused: { bg: 'yellow', text: 'yellow', icon: '⏸️' },
        stopped: { bg: 'gray', text: 'gray', icon: '⏹️' }
      };
      
      let html = '';
      
      for (const task of tasks) {
        const status = statusColors[task.status] || statusColors.stopped;
        const progressPct = task.progress_total ? Math.round((task.progress_current / task.progress_total) * 100) : 0;
        const lastHeartbeat = task.last_heartbeat ? new Date(task.last_heartbeat).toLocaleTimeString() : 'Never';
        
        html += `
          <div class="bg-gray-800 rounded-lg p-4 border border-${status.bg}-500/50">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span class="text-lg">${status.icon}</span>
                <span class="font-medium text-white">${task.title}</span>
                <span class="px-2 py-0.5 rounded text-xs bg-${status.bg}-600/30 text-${status.text}-400">${task.status}</span>
              </div>
              <div class="flex gap-2">
                ${task.status === 'running' ? `
                  <button onclick="controlOngoingTask('${task.task_key}', 'pause')" class="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 rounded text-xs font-medium">
                    ⏸️ Pause
                  </button>
                ` : ''}
                ${task.status === 'paused' ? `
                  <button onclick="controlOngoingTask('${task.task_key}', 'resume')" class="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-xs font-medium">
                    ▶️ Resume
                  </button>
                ` : ''}
                ${task.status === 'stopped' ? `
                  <button onclick="controlOngoingTask('${task.task_key}', 'start')" class="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs font-medium">
                    ▶️ Start
                  </button>
                ` : ''}
                ${task.status !== 'stopped' ? `
                  <button onclick="controlOngoingTask('${task.task_key}', 'stop')" class="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs font-medium">
                    ⏹️ Stop
                  </button>
                ` : ''}
              </div>
            </div>
            <div class="text-sm text-gray-400 mb-2">${task.description || ''}</div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <span class="text-gray-500">Progress:</span>
                <span class="text-white ml-1">${task.progress_current || 0}${task.progress_total ? '/' + task.progress_total : ''}</span>
              </div>
              <div>
                <span class="text-gray-500">Success:</span>
                <span class="text-green-400 ml-1">${task.success_count || 0}</span>
              </div>
              <div>
                <span class="text-gray-500">Failures:</span>
                <span class="text-red-400 ml-1">${task.failure_count || 0}</span>
              </div>
              <div>
                <span class="text-gray-500">Last Update:</span>
                <span class="text-white ml-1">${lastHeartbeat}</span>
              </div>
            </div>
            ${task.status === 'running' && task.progress_total ? `
              <div class="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div class="h-full bg-green-500 transition-all" style="width: ${progressPct}%"></div>
              </div>
            ` : ''}
          </div>
        `;
      }
      
      container.innerHTML = html;
    }
    
    // Control ongoing task (start/stop/pause/resume)
    async function controlOngoingTask(taskKey, action) {
      // This calls an API endpoint or updates the database
      // The actual process control happens server-side or via Jeff
      try {
        const updates = { updated_at: new Date().toISOString() };
        
        if (action === 'pause') {
          updates.status = 'paused';
          updates.paused_at = new Date().toISOString();
        } else if (action === 'resume' || action === 'start') {
          updates.status = 'running';
          updates.paused_at = null;
        } else if (action === 'stop') {
          updates.status = 'stopped';
          updates.pid = null;
        }
        
        const { error } = await supabase
          .from('ongoing_tasks')
          .update(updates)
          .eq('task_key', taskKey);
        
        if (error) throw error;
        
        // Show feedback
        alert(`Task ${action} requested. Jeff will handle the process control.`);
        
        // Refresh the list
        await loadOngoingTasks();
        
      } catch (error) {
        console.error('Error controlling ongoing task:', error);
        alert('Failed to update task: ' + error.message);
      }
    }
    
    // Expose to window
    window.loadOngoingTasks = loadOngoingTasks;
    window.controlOngoingTask = controlOngoingTask;
    
    // ==================== END ONGOING TASKS ====================
    
    // Load tasks from database
    async function loadTaskQueue() {
      try {
        const { data: tasks, error } = await supabase
          .from('task_queue')
          .select('*')
          .order('priority', { ascending: true })
          .order('created_at', { ascending: true });
        
        if (error) throw error;
        
        allTasks = tasks || [];
        renderTaskQueue(filterTasksByStatus(allTasks, currentTaskFilter));
        updateTaskSummary(allTasks);
        
      } catch (error) {
        console.error('Error loading task queue:', error);
      }
    }
    
    // Filter tasks based on status
    function filterTasksByStatus(tasks, filter) {
      if (filter === 'open') {
        return tasks.filter(t => !['complete', 'completed', 'rejected'].includes(t.status));
      } else if (filter === 'completed') {
        return tasks.filter(t => ['complete', 'completed'].includes(t.status));
      }
      return tasks; // 'all'
    }
    
    // Switch task filter tab
    function filterTasks(filter) {
      currentTaskFilter = filter;
      
      // Update tab button styles
      ['open', 'completed', 'ongoing', 'all'].forEach(f => {
        const btn = document.getElementById('task-filter-' + f);
        if (btn) {
          if (f === filter) {
            btn.className = 'px-4 py-2 rounded-t-lg text-sm font-medium bg-blue-600 text-white border-b-2 border-blue-400';
          } else {
            btn.className = 'px-4 py-2 rounded-t-lg text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-300';
          }
        }
      });
      
      // Show/hide appropriate containers
      const taskQueueContainer = document.getElementById('taskQueueContainer');
      const ongoingContainer = document.getElementById('ongoingTasksContainer');
      
      if (filter === 'ongoing') {
        // Show ongoing tasks, hide regular task queue
        if (taskQueueContainer) taskQueueContainer.classList.add('hidden');
        if (ongoingContainer) ongoingContainer.classList.remove('hidden');
        loadOngoingTasks();
      } else {
        // Show regular task queue, hide ongoing
        if (taskQueueContainer) taskQueueContainer.classList.remove('hidden');
        if (ongoingContainer) ongoingContainer.classList.add('hidden');
        // Re-render with filter
        if (allTasks.length > 0) {
          renderTaskQueue(filterTasksByStatus(allTasks, filter));
        }
      }
    }
    
    // Update task status
    async function updateTaskStatus(taskKey, newStatus) {
      try {
        const updates = { status: newStatus, updated_at: new Date().toISOString() };
        
        if (newStatus === 'approved') {
          updates.approved_at = new Date().toISOString();
        } else if (newStatus === 'running') {
          updates.started_at = new Date().toISOString();
        } else if (newStatus === 'complete' || newStatus === 'failed') {
          updates.completed_at = new Date().toISOString();
        }
        
        const { error } = await supabase
          .from('task_queue')
          .update(updates)
          .eq('task_key', taskKey);
        
        if (error) throw error;
        
        // Refresh the task list
        await loadTaskQueue();
        
      } catch (error) {
        console.error('Error updating task:', error);
        alert('Failed to update task: ' + error.message);
      }
    }
    
    // Render task queue UI
    function renderTaskQueue(tasks) {
      const container = document.getElementById('taskQueueContainer');
      if (!container) return;
      
      const owners = {
        jeff: { title: '🤖 Jeff (AI Agent)', color: 'cyan', emoji: '🤖' },
        maureen: { title: '👩‍💻 Maureen (Research)', color: 'pink', emoji: '👩‍💻' }
      };
      
      const statusColors = {
        pending: 'gray',
        approved: 'green',
        running: 'blue',
        complete: 'emerald',
        completed: 'emerald',
        failed: 'red',
        rejected: 'gray'
      };
      
      const statusIcons = {
        pending: '⏳',
        approved: '✅',
        running: '🔄',
        complete: '✓',
        completed: '✓',
        failed: '❌',
        rejected: '🚫'
      };
      
      // Group tasks by owner first
      const byOwner = {};
      tasks.forEach(task => {
        const owner = task.owner || 'jeff';
        if (!byOwner[owner]) byOwner[owner] = [];
        byOwner[owner].push(task);
      });
      
      let html = '';
      
      // Render each owner's section
      for (const [ownerKey, ownerInfo] of Object.entries(owners)) {
        const ownerTasks = byOwner[ownerKey] || [];
        if (ownerTasks.length === 0) continue;
        
        const pendingCount = ownerTasks.filter(t => t.status === 'pending').length;
        const completeCount = ownerTasks.filter(t => t.status === 'complete' || t.status === 'completed').length;
        
        html += `
          <div class="mb-8">
            <div class="flex items-center justify-between mb-4 pb-2 border-b border-${ownerInfo.color}-500/30">
              <h3 class="text-xl font-bold text-${ownerInfo.color}-400">${ownerInfo.title}</h3>
              <div class="flex gap-3 text-sm">
                <span class="text-gray-400">⏳ ${pendingCount} pending</span>
                <span class="text-emerald-400">✓ ${completeCount} done</span>
              </div>
            </div>
            <div class="space-y-2">
        `;
        
        for (const task of ownerTasks) {
          const statusColor = statusColors[task.status] || 'gray';
          const statusIcon = statusIcons[task.status] || '?';
          const isActionable = task.status === 'pending';
          const isComplete = task.status === 'complete' || task.status === 'completed';
          const isRunning = task.status === 'running';
          
          const catColor = task.category === 'pipeline' ? 'purple' : 
                          task.category === 'research' ? 'blue' : 
                          task.category === 'data_gaps' ? 'red' : 
                          task.category === 'expansion' ? 'yellow' : 'gray';
          
          html += `
            <div class="task-card flex items-start gap-3 p-3 bg-gray-700/30 rounded border-l-2 border-${ownerInfo.color}-500 ${isComplete ? 'opacity-60' : ''}">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-${statusColor}-400">${statusIcon}</span>
                  <span class="font-medium ${isComplete ? 'line-through' : ''}">${task.title}</span>
                  ${task.category ? `<span class="text-xs px-2 py-0.5 rounded bg-${catColor}-500/20 text-${catColor}-300">${task.category}</span>` : ''}
                </div>
                <p class="text-sm text-gray-400 mt-1">${task.description || ''}</p>
                <div class="flex gap-4 mt-2 text-xs">
                  ${task.estimated_products ? `<span class="text-${ownerInfo.color}-400">📊 ${task.estimated_products.toLocaleString()} products</span>` : ''}
                  ${task.estimated_time ? `<span class="text-gray-500">⏱️ ${task.estimated_time}</span>` : ''}
                  ${task.difficulty ? `<span class="text-gray-500">${task.difficulty === 'easy' ? '🟢' : task.difficulty === 'medium' ? '🟡' : '🔴'} ${task.difficulty}</span>` : ''}
                </div>
                ${task.result_summary ? `<div class="mt-2 text-xs text-emerald-400">✓ ${task.result_summary}</div>` : ''}
                ${task.error_message ? `<div class="mt-2 text-xs text-red-400">⚠️ ${task.error_message}</div>` : ''}
              </div>
              <div class="flex gap-2">
                ${isActionable ? `
                  <button onclick="approveTask('${task.task_key}')" class="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-xs font-medium">
                    ✓ Approve
                  </button>
                  <button onclick="rejectTask('${task.task_key}')" class="px-2 py-1 bg-gray-600 hover:bg-gray-700 rounded text-xs">
                    ✗
                  </button>
                ` : ''}
                ${isRunning ? `<span class="px-3 py-1 bg-blue-600/50 rounded text-xs animate-pulse">Running...</span>` : ''}
                ${!isComplete && !isActionable ? `
                  <button onclick="completeTask('${task.task_key}')" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 rounded text-xs font-medium">
                    ✓ Mark Complete
                  </button>
                ` : ''}
                ${isComplete ? `<span class="px-3 py-1 bg-emerald-600/30 rounded text-xs text-emerald-400">Done</span>` : ''}
              </div>
            </div>
          `;
        }
        
        html += '</div></div>';
      }
      
      container.innerHTML = html || '<div class="text-gray-400">No tasks in queue</div>';
    }
    
    // Update task summary stats
    function updateTaskSummary(tasks) {
      const total = tasks.length;
      const approved = tasks.filter(t => t.status === 'approved').length;
      const running = tasks.filter(t => t.status === 'running').length;
      const complete = tasks.filter(t => t.status === 'complete').length;
      const pending = tasks.filter(t => t.status === 'pending').length;
      
      const totalProducts = tasks
        .filter(t => t.status !== 'complete' && t.status !== 'rejected')
        .reduce((sum, t) => sum + (t.estimated_products || 0), 0);
      
      document.getElementById('taskTotal')?.textContent && (document.getElementById('taskTotal').textContent = total);
      document.getElementById('taskApproved')?.textContent && (document.getElementById('taskApproved').textContent = approved + running);
      document.getElementById('taskComplete')?.textContent && (document.getElementById('taskComplete').textContent = complete);
      document.getElementById('taskPending')?.textContent && (document.getElementById('taskPending').textContent = pending);
      document.getElementById('taskProducts')?.textContent && (document.getElementById('taskProducts').textContent = totalProducts.toLocaleString() + '+');
    }
    
    // Approve a task
    async function approveTask(taskKey) {
      if (!confirm('Approve this task for execution?')) return;
      await updateTaskStatus(taskKey, 'approved');
    }
    
    // Reject a task
    async function rejectTask(taskKey) {
      await updateTaskStatus(taskKey, 'rejected');
    }
    
    // Mark task complete (for human tasks or manual completion)
    async function completeTask(taskKey) {
      const summary = prompt('Result summary (optional):');
      try {
        const updates = {
          status: 'complete',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        if (summary) updates.result_summary = summary;
        
        const { error } = await supabase
          .from('task_queue')
          .update(updates)
          .eq('task_key', taskKey);
        
        if (error) throw error;
        await loadTaskQueue();
      } catch (error) {
        console.error('Error completing task:', error);
        alert('Failed to complete task: ' + error.message);
      }
    }
    
    // Expose to window
    window.completeTask = completeTask;
    
    // ==================== PROJECTS ====================
    
    async function loadProjects() {
      try {
        // Load projects from task_queue where is_project=true
        const { data: projects, error: projError } = await supabase
          .from('task_queue')
          .select('*')
          .eq('is_project', true)
          .order('priority', { ascending: true });
        
        if (projError) throw projError;
        
        // Load all subtasks
        const { data: allTasks, error: taskError } = await supabase
          .from('task_queue')
          .select('*')
          .eq('is_project', false)
          .not('project_key', 'is', null)
          .order('priority', { ascending: true });
        
        if (taskError) throw taskError;
        
        // Group subtasks by project_key
        const subtasksByProject = {};
        allTasks.forEach(task => {
          if (!subtasksByProject[task.project_key]) subtasksByProject[task.project_key] = [];
          subtasksByProject[task.project_key].push(task);
        });
        
        // Update summary counts
        document.getElementById('projectTotal').textContent = projects.length;
        document.getElementById('projectCritical').textContent = 
          projects.filter(p => p.priority === 1).length;
        document.getElementById('projectHigh').textContent = 
          projects.filter(p => p.priority === 2).length;
        document.getElementById('projectActive').textContent = 
          projects.filter(p => !['complete', 'completed', 'archived'].includes(p.status)).length;
        
        // Status colors and icons
        const statusColors = {
          planning: 'blue',
          research: 'purple', 
          pending: 'yellow',
          running: 'green',
          complete: 'emerald',
          completed: 'emerald',
          archived: 'gray'
        };
        
        const priorityBadges = {
          1: { color: 'red', label: '🔴 P1' },
          2: { color: 'orange', label: '🟠 P2' },
          3: { color: 'yellow', label: '🟡 P3' },
          4: { color: 'blue', label: '🔵 P4' },
          5: { color: 'gray', label: '⚪ P5' },
          6: { color: 'gray', label: '⚪ P6' }
        };
        
        const owners = {
          jeff: { title: '🤖 Jeff (AI Agent)', color: 'cyan' },
          maureen: { title: '👩‍💻 Maureen (Research)', color: 'pink' }
        };
        
        // Group projects by owner
        const byOwner = {};
        projects.forEach(p => {
          const owner = p.owner || 'jeff';
          if (!byOwner[owner]) byOwner[owner] = [];
          byOwner[owner].push(p);
        });
        
        // Render project cards grouped by owner
        const grid = document.getElementById('projectsGrid');
        let html = '';
        
        for (const [ownerKey, ownerInfo] of Object.entries(owners)) {
          const ownerProjects = byOwner[ownerKey] || [];
          
          html += `
            <div class="col-span-full mb-4">
              <h3 class="text-lg font-bold text-${ownerInfo.color}-400 border-b border-${ownerInfo.color}-500/30 pb-2 mb-4">
                ${ownerInfo.title}
                <span class="text-sm font-normal text-gray-500 ml-2">(${ownerProjects.length} projects)</span>
              </h3>
            </div>
          `;
          
          if (ownerProjects.length === 0) {
            html += `<div class="col-span-full text-gray-500 mb-6">No projects assigned</div>`;
            continue;
          }
          
          for (const project of ownerProjects) {
            const statusColor = statusColors[project.status] || 'gray';
            const priority = priorityBadges[project.priority] || priorityBadges[5];
            const localPath = `projects/${project.project_key}/`;
            const subtasks = subtasksByProject[project.project_key] || [];
            const completedSubtasks = subtasks.filter(t => t.status === 'complete' || t.status === 'completed').length;
            
            html += `
              <div class="bg-gray-900 rounded-lg p-4 border border-gray-700 hover:border-${ownerInfo.color}-500/50 transition-colors">
                <div class="flex items-start justify-between mb-2">
                  <h4 class="font-semibold text-white">📁 ${project.title}</h4>
                  <span class="text-xs px-2 py-1 rounded-full bg-${priority.color}-900/50 text-${priority.color}-400 border border-${priority.color}-700">
                    ${priority.label}
                  </span>
                </div>
                <div class="flex items-center gap-2 mb-3">
                  <span class="inline-block w-2 h-2 rounded-full bg-${statusColor}-500"></span>
                  <span class="text-sm text-${statusColor}-400 capitalize">${project.status}</span>
                  ${subtasks.length > 0 ? `<span class="text-xs text-gray-500 ml-2">• ${completedSubtasks}/${subtasks.length} tasks</span>` : ''}
                </div>
                ${project.description ? `<p class="text-sm text-gray-400 mb-3">${project.description}</p>` : ''}
                
                ${subtasks.length > 0 ? `
                  <div class="mt-3 pt-3 border-t border-gray-700">
                    <div class="text-xs text-gray-500 mb-2">Subtasks:</div>
                    <div class="space-y-1">
                      ${subtasks.slice(0, 5).map(t => `
                        <div class="text-xs flex items-center gap-2">
                          <span class="${t.status === 'complete' || t.status === 'completed' ? 'text-emerald-400' : t.status === 'running' ? 'text-blue-400' : 'text-gray-500'}">
                            ${t.status === 'complete' || t.status === 'completed' ? '✓' : t.status === 'running' ? '🔄' : '○'}
                          </span>
                          <span class="${t.status === 'complete' || t.status === 'completed' ? 'text-gray-500 line-through' : 'text-gray-400'}">${t.title}</span>
                        </div>
                      `).join('')}
                      ${subtasks.length > 5 ? `<div class="text-xs text-gray-600">+${subtasks.length - 5} more...</div>` : ''}
                    </div>
                  </div>
                ` : ''}
                
                <div class="text-xs text-gray-500 flex items-center gap-1 mt-3">
                  <span>📂</span>
                  <code class="bg-gray-800 px-1 rounded">${localPath}</code>
                </div>
              </div>
            `;
          }
        }
        
        grid.innerHTML = html || '<div class="text-gray-400 col-span-full">No projects found</div>';
        
      } catch (error) {
        console.error('Error loading projects:', error);
        document.getElementById('projectsGrid').innerHTML = 
          `<div class="text-red-400 col-span-full text-center py-8">Error loading projects: ${error.message}</div>`;
      }
    }
    
    // ==================== MOBILE MVP TAB ====================
    
    let currentMVPFilter = 'all';
    let mvpItems = [];
    
    async function loadMobileMVP() {
      try {
        const { data, error } = await supabase
          .from('mobile_mvp_items')
          .select('*')
          .order('priority')
          .order('category')
          .order('title');
        
        if (error) throw error;
        mvpItems = data || [];
        renderMVPItems();
      } catch (error) {
        console.error('Error loading MVP items:', error);
        document.getElementById('mvp-items').innerHTML = 
          `<div class="text-red-400 text-center py-8">Error loading MVP items: ${error.message}</div>`;
      }
    }
    
    function renderMVPItems() {
      const filtered = currentMVPFilter === 'all' 
        ? mvpItems 
        : mvpItems.filter(item => item.priority === currentMVPFilter);
      
      // Calculate progress
      const total = filtered.length;
      const complete = filtered.filter(i => i.status === 'complete').length;
      const percent = total > 0 ? Math.round((complete / total) * 100) : 0;
      
      document.getElementById('mvp-progress').textContent = `${complete}/${total} complete`;
      document.getElementById('mvp-percent').textContent = `${percent}%`;
      document.getElementById('mvp-bar').style.width = `${percent}%`;
      document.getElementById('mvp-complete').textContent = `${complete} complete`;
      document.getElementById('mvp-total').textContent = `${total} total`;
      
      // Group by category
      const byCategory = {};
      filtered.forEach(item => {
        if (!byCategory[item.category]) byCategory[item.category] = [];
        byCategory[item.category].push(item);
      });
      
      const priorityColors = {
        'P0': { bg: 'red', label: '🔴 Critical' },
        'P1': { bg: 'yellow', label: '🟡 High' },
        'P2': { bg: 'green', label: '🟢 Nice-to-Have' }
      };
      
      const statusIcons = {
        'complete': '✅',
        'in_progress': '🔄',
        'blocked': '🚫',
        'not_started': '⬜'
      };
      
      let html = '';
      
      for (const [category, items] of Object.entries(byCategory)) {
        const categoryComplete = items.filter(i => i.status === 'complete').length;
        const categoryPercent = Math.round((categoryComplete / items.length) * 100);
        
        html += `
          <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div class="flex justify-between items-center mb-3">
              <h3 class="font-semibold text-white">${category}</h3>
              <span class="text-sm text-gray-400">${categoryComplete}/${items.length} (${categoryPercent}%)</span>
            </div>
            <div class="w-full bg-gray-700 rounded-full h-1.5 mb-4">
              <div class="bg-green-500 h-1.5 rounded-full" style="width: ${categoryPercent}%"></div>
            </div>
            <div class="space-y-2">
        `;
        
        for (const item of items) {
          const priority = priorityColors[item.priority] || priorityColors['P1'];
          const statusIcon = statusIcons[item.status] || '⬜';
          const isComplete = item.status === 'complete';
          
          html += `
            <div class="flex items-start gap-3 p-2 rounded hover:bg-gray-700/50 ${isComplete ? 'opacity-60' : ''}">
              <button onclick="toggleMVPStatus('${item.id}', '${item.status}')" 
                      class="text-lg flex-shrink-0 hover:scale-110 transition-transform"
                      title="Click to toggle status">
                ${statusIcon}
              </button>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="${isComplete ? 'line-through text-gray-500' : 'text-white'}">${item.title}</span>
                  <span class="text-xs px-1.5 py-0.5 rounded bg-${priority.bg}-900/50 text-${priority.bg}-400">${item.priority}</span>
                  ${item.screen_name ? `<span class="text-xs text-gray-500">📱 ${item.screen_name}</span>` : ''}
                </div>
                ${item.description ? `<p class="text-xs text-gray-500 mt-1">${item.description}</p>` : ''}
              </div>
            </div>
          `;
        }
        
        html += `
            </div>
          </div>
        `;
      }
      
      document.getElementById('mvp-items').innerHTML = html || '<div class="text-gray-400 text-center py-8">No items found</div>';
    }
    
    async function toggleMVPStatus(id, currentStatus) {
      const newStatus = currentStatus === 'complete' ? 'not_started' : 
                        currentStatus === 'not_started' ? 'in_progress' :
                        currentStatus === 'in_progress' ? 'complete' : 'not_started';
      
      try {
        const updates = { 
          status: newStatus, 
          updated_at: new Date().toISOString()
        };
        if (newStatus === 'complete') {
          updates.completed_at = new Date().toISOString();
        } else {
          updates.completed_at = null;
        }
        
        const { error } = await supabase
          .from('mobile_mvp_items')
          .update(updates)
          .eq('id', id);
        
        if (error) throw error;
        
        // Update local state and re-render
        const item = mvpItems.find(i => i.id === id);
        if (item) {
          item.status = newStatus;
          item.completed_at = updates.completed_at;
        }
        renderMVPItems();
      } catch (error) {
        console.error('Error updating MVP item:', error);
        alert('Failed to update status: ' + error.message);
      }
    }
    
    function filterMVP(priority) {
      currentMVPFilter = priority;
      
      // Update filter buttons
      document.querySelectorAll('.mvp-filter').forEach(btn => {
        if (btn.dataset.filter === priority) {
          btn.classList.remove('bg-gray-700');
          btn.classList.add('bg-blue-600');
        } else {
          btn.classList.remove('bg-blue-600');
          btn.classList.add('bg-gray-700');
        }
      });
      
      renderMVPItems();
    }
    
    // ==================== CONTENT PIPELINE ====================
    
    async function loadContentPipeline() {
      try {
        // Load content queue stats
        const { data: queue, error: qError } = await supabase
          .from('content_queue')
          .select('status, content_type, platform, title, published_at, requires_approval, approved_at');
        
        if (qError) throw qError;
        
        // Calculate stats
        const stats = {
          total: queue?.length || 0,
          draft: queue?.filter(q => q.status === 'draft').length || 0,
          scheduled: queue?.filter(q => q.status === 'scheduled').length || 0,
          published: queue?.filter(q => q.status === 'published').length || 0,
          failed: queue?.filter(q => q.status === 'failed').length || 0
        };
        
        // Update summary cards
        document.getElementById('contentQueueTotal').textContent = stats.total;
        document.getElementById('contentDraft').textContent = stats.draft;
        document.getElementById('contentScheduled').textContent = stats.scheduled;
        document.getElementById('contentPublished').textContent = stats.published;
        document.getElementById('contentFailed').textContent = stats.failed;
        
        // Pending review items
        const pendingReview = queue?.filter(q => q.requires_approval && !q.approved_at) || [];
        const reviewHtml = pendingReview.length > 0 
          ? pendingReview.slice(0, 5).map(item => `
              <div class="p-2 bg-gray-700/30 rounded flex justify-between items-center">
                <span class="text-gray-300">${item.title || 'Untitled'}</span>
                <span class="text-xs text-purple-400">${item.platform}</span>
              </div>
            `).join('')
          : '<div class="text-gray-500">No items pending review</div>';
        document.getElementById('contentReviewQueue').innerHTML = reviewHtml;
        
        // Recent published
        const recentPublished = queue?.filter(q => q.status === 'published')
          .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
          .slice(0, 5) || [];
        const publishedHtml = recentPublished.length > 0
          ? recentPublished.map(item => `
              <div class="p-2 bg-gray-700/30 rounded flex justify-between items-center">
                <span class="text-gray-300">${item.title || 'Untitled'}</span>
                <span class="text-xs text-green-400">${item.platform} • ${new Date(item.published_at).toLocaleDateString()}</span>
              </div>
            `).join('')
          : '<div class="text-gray-500">No published content yet</div>';
        document.getElementById('contentRecentPublished').innerHTML = publishedHtml;
        
        // Load published articles from public_articles
        const { data: articles, error: aError } = await supabase
          .from('public_articles')
          .select('title, slug, category, published_at, is_current')
          .eq('is_current', true)
          .order('published_at', { ascending: false })
          .limit(10);
        
        const articlesHtml = articles?.length > 0
          ? articles.map(a => `
              <div class="p-2 bg-gray-700/30 rounded flex justify-between items-center">
                <span class="text-gray-300">${a.title}</span>
                <span class="text-xs text-cyan-400">${a.category || 'uncategorized'}</span>
              </div>
            `).join('')
          : '<div class="text-gray-500">No published articles yet</div>';
        document.getElementById('contentPublishedArticles').innerHTML = articlesHtml;
        
      } catch (error) {
        console.error('Error loading content pipeline:', error);
      }
    }
    
    // Expose MVP functions globally
    window.loadMobileMVP = loadMobileMVP;
    window.toggleMVPStatus = toggleMVPStatus;
    window.filterMVP = filterMVP;
    window.loadContentPipeline = loadContentPipeline;
    
    // Expose task functions globally
    window.approveTask = approveTask;
    window.rejectTask = rejectTask;
    window.loadTaskQueue = loadTaskQueue;
    window.loadProjects = loadProjects;
    window.filterTasks = filterTasks;
    
    // ==================== CONTENT PIPELINE TAB ====================
    
    async function loadPipeline() {
      if (!supabase) return;
      
      try {
        // Fetch all task_queue data
        const { data: allTasks, error: taskErr } = await supabase
          .from('task_queue')
          .select('*')
          .eq('is_project', false)
          .order('priority', { ascending: true });
        
        if (taskErr) throw taskErr;
        
        // Fetch pipeline-category tasks
        const pipelineTasks = allTasks.filter(t => t.category === 'pipeline');
        
        // Fetch content_queue
        const { data: contentQueue } = await supabase
          .from('content_queue')
          .select('*')
          .order('created_at', { ascending: false });
        
        // Fetch longevity_content (published articles)
        const { data: longevityContent } = await supabase
          .from('longevity_content')
          .select('*')
          .order('captured_at', { ascending: false });
        
        // Fetch digest articles
        const { data: digestArticles } = await supabase
          .from('longevity_digest_articles')
          .select('*')
          .order('created_at', { ascending: false });
        
        const cq = contentQueue || [];
        const lc = longevityContent || [];
        const da = digestArticles || [];
        
        // --- Summary metrics ---
        const running = allTasks.filter(t => t.status === 'running').length;
        const completed = allTasks.filter(t => t.status === 'completed' || t.status === 'complete').length;
        const failed = allTasks.filter(t => t.status === 'failed').length;
        const total = allTasks.length;
        const successRate = (completed + failed) > 0 
          ? Math.round((completed / (completed + failed)) * 100) + '%' 
          : 'N/A';
        
        document.getElementById('plTotal').textContent = total;
        document.getElementById('plRunning').textContent = running;
        document.getElementById('plCompleted').textContent = completed;
        document.getElementById('plFailed').textContent = failed;
        document.getElementById('plSuccessRate').textContent = successRate;
        
        // --- Queue Overview (by priority, category, status) ---
        const byPriority = {};
        const byCategory = {};
        const byStatus = {};
        allTasks.forEach(t => {
          const p = t.priority || 5;
          byPriority[p] = (byPriority[p] || 0) + 1;
          const cat = t.category || 'uncategorized';
          byCategory[cat] = (byCategory[cat] || 0) + 1;
          byStatus[t.status] = (byStatus[t.status] || 0) + 1;
        });
        
        const priorityLabels = { 1: '🔴 Critical', 2: '🟠 High', 3: '🟡 Medium', 4: '🔵 Low', 5: '⚪ Default' };
        const priorityColors = { 1: 'text-red-400', 2: 'text-orange-400', 3: 'text-yellow-400', 4: 'text-blue-400', 5: 'text-gray-400' };
        
        let queueHtml = '<div class="mb-4"><h4 class="text-sm font-medium text-gray-300 mb-2">By Priority</h4>';
        Object.keys(byPriority).sort().forEach(p => {
          queueHtml += `<div class="flex justify-between text-sm py-1 border-b border-gray-700/50">
            <span>${priorityLabels[p] || 'P' + p}</span>
            <span class="${priorityColors[p] || 'text-gray-400'} font-mono">${byPriority[p]}</span>
          </div>`;
        });
        queueHtml += '</div>';
        
        queueHtml += '<div class="mb-4"><h4 class="text-sm font-medium text-gray-300 mb-2">By Category</h4>';
        Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 8).forEach(([cat, count]) => {
          queueHtml += `<div class="flex justify-between text-sm py-1 border-b border-gray-700/50">
            <span class="text-gray-300">${cat}</span>
            <span class="text-blue-400 font-mono">${count}</span>
          </div>`;
        });
        queueHtml += '</div>';
        
        document.getElementById('plQueueOverview').innerHTML = queueHtml;
        
        // --- Generation Status ---
        const statusColors = {
          pending: 'bg-yellow-500', approved: 'bg-blue-500', running: 'bg-cyan-500',
          completed: 'bg-green-500', complete: 'bg-green-500', failed: 'bg-red-500', planning: 'bg-purple-500'
        };
        
        let genHtml = '<div class="space-y-3">';
        Object.entries(byStatus).sort((a, b) => b[1] - a[1]).forEach(([status, count]) => {
          const pct = Math.round((count / total) * 100);
          const color = statusColors[status] || 'bg-gray-500';
          genHtml += `<div>
            <div class="flex justify-between text-sm mb-1">
              <span class="capitalize">${status}</span>
              <span class="text-gray-400">${count} (${pct}%)</span>
            </div>
            <div class="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div class="h-full ${color} rounded-full" style="width: ${pct}%"></div>
            </div>
          </div>`;
        });
        genHtml += '</div>';
        
        // Content queue status
        if (cq.length > 0) {
          const cqByStatus = {};
          cq.forEach(c => { cqByStatus[c.status] = (cqByStatus[c.status] || 0) + 1; });
          genHtml += '<div class="mt-4 pt-3 border-t border-gray-700"><h4 class="text-sm font-medium text-gray-300 mb-2">Content Queue</h4>';
          Object.entries(cqByStatus).forEach(([s, c]) => {
            genHtml += `<div class="flex justify-between text-sm py-1"><span class="capitalize text-gray-300">${s}</span><span class="font-mono text-gray-400">${c}</span></div>`;
          });
          genHtml += '</div>';
        }
        
        document.getElementById('plGenerationStatus').innerHTML = genHtml;
        
        // --- Review Queue ---
        const pending = allTasks.filter(t => t.status === 'pending');
        const approved = allTasks.filter(t => t.status === 'approved');
        
        let reviewHtml = `
          <div class="grid grid-cols-3 gap-3 mb-4">
            <div class="text-center p-3 bg-yellow-900/30 rounded-lg border border-yellow-700/50">
              <div class="text-2xl font-bold text-yellow-400">${pending.length}</div>
              <div class="text-xs text-gray-400">Pending Review</div>
            </div>
            <div class="text-center p-3 bg-blue-900/30 rounded-lg border border-blue-700/50">
              <div class="text-2xl font-bold text-blue-400">${approved.length}</div>
              <div class="text-xs text-gray-400">Approved</div>
            </div>
            <div class="text-center p-3 bg-red-900/30 rounded-lg border border-red-700/50">
              <div class="text-2xl font-bold text-red-400">${failed}</div>
              <div class="text-xs text-gray-400">Rejected/Failed</div>
            </div>
          </div>`;
        
        // Show recent pending tasks
        if (pending.length > 0) {
          reviewHtml += '<h4 class="text-sm font-medium text-gray-300 mb-2">Awaiting Review</h4>';
          pending.slice(0, 5).forEach(t => {
            const pLabel = priorityLabels[t.priority] || '';
            reviewHtml += `<div class="text-sm py-1.5 border-b border-gray-700/50 flex justify-between items-center">
              <span class="text-gray-300 truncate mr-2">${t.title}</span>
              <span class="text-xs whitespace-nowrap">${pLabel}</span>
            </div>`;
          });
          if (pending.length > 5) {
            reviewHtml += `<div class="text-xs text-gray-500 mt-1">+${pending.length - 5} more pending</div>`;
          }
        }
        
        document.getElementById('plReviewQueue').innerHTML = reviewHtml;
        
        // --- Published Content ---
        const totalArticles = lc.length + da.length;
        
        // Group longevity_content by source
        const bySource = {};
        lc.forEach(a => { bySource[a.source || 'unknown'] = (bySource[a.source || 'unknown'] || 0) + 1; });
        
        // Group digest articles by topic/source if available
        const byTopic = {};
        lc.forEach(a => { if (a.topic) byTopic[a.topic] = (byTopic[a.topic] || 0) + 1; });
        
        let pubHtml = `
          <div class="grid grid-cols-2 gap-3 mb-4">
            <div class="text-center p-3 bg-green-900/30 rounded-lg border border-green-700/50">
              <div class="text-2xl font-bold text-green-400">${lc.length}</div>
              <div class="text-xs text-gray-400">Content Items</div>
            </div>
            <div class="text-center p-3 bg-purple-900/30 rounded-lg border border-purple-700/50">
              <div class="text-2xl font-bold text-purple-400">${da.length}</div>
              <div class="text-xs text-gray-400">Digest Articles</div>
            </div>
          </div>`;
        
        if (Object.keys(bySource).length > 0) {
          pubHtml += '<h4 class="text-sm font-medium text-gray-300 mb-2">By Source</h4>';
          Object.entries(bySource).sort((a, b) => b[1] - a[1]).forEach(([src, count]) => {
            pubHtml += `<div class="flex justify-between text-sm py-1 border-b border-gray-700/50">
              <span class="text-gray-300">${src}</span>
              <span class="text-green-400 font-mono">${count}</span>
            </div>`;
          });
        }
        
        // Recent articles
        const recent = lc.slice(0, 3);
        if (recent.length > 0) {
          pubHtml += '<h4 class="text-sm font-medium text-gray-300 mt-3 mb-2">Recent</h4>';
          recent.forEach(a => {
            const date = a.captured_at ? new Date(a.captured_at).toLocaleDateString() : '';
            pubHtml += `<div class="text-sm py-1.5 border-b border-gray-700/50">
              <div class="text-gray-300 truncate">${a.title || a.content?.substring(0, 60) + '...'}</div>
              <div class="text-xs text-gray-500">${a.source || ''} · ${date}</div>
            </div>`;
          });
        }
        
        document.getElementById('plPublished').innerHTML = pubHtml;
        
        // --- Pipeline Health ---
        const avgCompletionDays = completed > 0 
          ? allTasks.filter(t => t.completed_at && t.created_at)
              .map(t => (new Date(t.completed_at) - new Date(t.created_at)) / (1000 * 60 * 60 * 24))
              .reduce((sum, d, _, arr) => sum + d / arr.length, 0).toFixed(1)
          : 'N/A';
        
        const throughputWeek = allTasks.filter(t => {
          if (!t.completed_at) return false;
          const d = new Date(t.completed_at);
          return (Date.now() - d.getTime()) < 7 * 24 * 60 * 60 * 1000;
        }).length;
        
        document.getElementById('plHealth').innerHTML = `
          <div class="text-center p-4 bg-gray-700/30 rounded-lg">
            <div class="text-3xl font-bold text-emerald-400">${successRate}</div>
            <div class="text-sm text-gray-400 mt-1">Success Rate</div>
            <div class="text-xs text-gray-500">${completed} completed / ${completed + failed} resolved</div>
          </div>
          <div class="text-center p-4 bg-gray-700/30 rounded-lg">
            <div class="text-3xl font-bold text-blue-400">${avgCompletionDays}</div>
            <div class="text-sm text-gray-400 mt-1">Avg Days to Complete</div>
            <div class="text-xs text-gray-500">From creation to completion</div>
          </div>
          <div class="text-center p-4 bg-gray-700/30 rounded-lg">
            <div class="text-3xl font-bold text-purple-400">${throughputWeek}</div>
            <div class="text-sm text-gray-400 mt-1">Completed This Week</div>
            <div class="text-xs text-gray-500">Last 7 days throughput</div>
          </div>
        `;
        
        // --- Recent Pipeline Tasks ---
        const recentTasks = allTasks
          .filter(t => t.category === 'pipeline')
          .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
          .slice(0, 10);
        
        if (recentTasks.length === 0) {
          // Show all recent tasks if no pipeline-specific ones
          const recent = allTasks
            .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
            .slice(0, 10);
          recentTasks.push(...recent);
        }
        
        const statusIcons = {
          pending: '⏳', approved: '✅', running: '🔄', completed: '✅', complete: '✅',
          failed: '❌', planning: '📋'
        };
        const statusTextColors = {
          pending: 'text-yellow-400', approved: 'text-blue-400', running: 'text-cyan-400',
          completed: 'text-green-400', complete: 'text-green-400', failed: 'text-red-400', planning: 'text-purple-400'
        };
        
        let tasksHtml = '';
        recentTasks.forEach(t => {
          const icon = statusIcons[t.status] || '❓';
          const color = statusTextColors[t.status] || 'text-gray-400';
          const date = t.updated_at ? new Date(t.updated_at).toLocaleDateString() : '';
          tasksHtml += `<div class="flex items-center justify-between py-2 border-b border-gray-700/50 hover:bg-gray-700/30 px-2 rounded">
            <div class="flex items-center gap-2 min-w-0">
              <span>${icon}</span>
              <span class="text-sm text-gray-300 truncate">${t.title}</span>
            </div>
            <div class="flex items-center gap-3 flex-shrink-0">
              <span class="text-xs ${color} capitalize">${t.status}</span>
              <span class="text-xs text-gray-500">${date}</span>
            </div>
          </div>`;
        });
        
        document.getElementById('plRecentTasks').innerHTML = tasksHtml || '<div class="text-gray-400 text-sm">No pipeline tasks found</div>';
        
      } catch (err) {
        console.error('[Pipeline] Error:', err);
        document.getElementById('plQueueOverview').innerHTML = `<div class="text-red-400 text-sm">Error loading: ${err.message}</div>`;
      }
    }
    
    window.loadPipeline = loadPipeline;

    // Expose for button and debugging
    window.refreshAll = refreshAll;
    window.dashboardInit = init;
    
    // Initialize immediately (module scripts run after DOM is ready)
    console.log('[Dashboard] Module loaded, calling init()');
    try {
      await init();
      // Also load task queue if on tasks tab
      if (document.getElementById('taskQueueContainer')) {
        await loadTaskQueue();
      }
      console.log('[Dashboard] Init complete');
    } catch(e) {
      console.error('Dashboard init failed:', e);
    }
