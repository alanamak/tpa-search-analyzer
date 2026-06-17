(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));

  const state = {
    searchFile: null,
    targetFile: null,
    rows: [],
    targetRows: [],
    mapped: null,
    targetMapped: null,
    periods: { weekly: [], monthly: [] },
    mode: "weekly",
    selectedPeriod: "__ALL__",
    goal: "revenue",
    hasUnits: false,
    analysis: null,
  };

  const columnAliases = {
    account: ["account name", "account", "advertiser"],
    week: ["week", "reporting week", "date range", "week date"],
    month: ["month", "reporting month", "calendar month"],
    campaign: ["campaign name", "campaign"],
    media: ["media name", "media", "line item", "line item name"],
    keyword: ["keyword", "search term", "search terms", "shopper search term", "query"],
    spend: ["actualized vendor spend", "spend", "ad spend", "actual spend", "cost"],
    sales: ["attributed total sales", "sales", "ad sales", "attributed sales", "revenue"],
    orders: ["attributed total orders", "orders", "ad orders", "attributed orders"],
    units: ["attributed total units", "units", "ad units", "attributed units", "total units"],
    clicks: ["clicks", "total clicks"],
    impressions: ["impressions", "total impressions"],
    roas: ["roas", "return on ad spend"],
    ctr: ["ctr", "click through rate"],
    cpc: ["cost per click (cpc)", "cpc", "cost per click"],
  };

  const targetAliases = {
    keyword: ["keyword", "target", "target keyword", "search term", "targeting expression"],
    campaign: ["campaign name", "campaign"],
    media: ["media name", "media", "line item", "line item name", "ad group"],
    matchType: ["match type", "keyword match type"],
    bid: ["bid", "current bid", "keyword bid", "max cpc", "cpc bid"],
    status: ["status", "state"],
  };

  const stopwords = new Set(["a", "an", "the", "of", "for", "and", "or", "to", "in", "on", "with", "by"]);

  const goalCopy = {
    unit: {
      note: "Unit CVR must be at or above the selected period’s non-branded benchmark. Opportunities are sorted by highest Unit CVR.",
      ineff: "Unit CVR at or below 50% of the non-branded benchmark is treated as an inefficiency.",
    },
    revenue: {
      note: "Order CVR must be at or above the selected period’s non-branded benchmark. Opportunities are sorted by highest attributed Sales.",
      ineff: "Order CVR at or below 50% of the non-branded benchmark is treated as an inefficiency.",
    },
    roas: {
      note: "ROAS must be at least 15% above the selected period’s non-branded benchmark. Opportunities are sorted by highest ROAS.",
      ineff: "ROAS at or below 85% of the non-branded benchmark is treated as an inefficiency.",
    },
    manual: {
      note: "Enter fixed values or benchmark-relative minimums. Blank fields and Off metric modes are not used as filters.",
      ineff: "Enter one or more fixed or benchmark-relative ceilings. Qualified inefficiencies must meet every active ceiling.",
    },
  };

  function normalizeHeader(value) {
    return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function findColumn(headers, aliases) {
    const normalized = headers.map((header) => ({ original: header, normalized: normalizeHeader(header) }));
    for (const alias of aliases) {
      const exact = normalized.find((item) => item.normalized === alias);
      if (exact) return exact.original;
    }
    for (const alias of aliases) {
      const partial = normalized.find((item) => item.normalized.includes(alias));
      if (partial) return partial.original;
    }
    return null;
  }

  function mapColumns(rows, aliases) {
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const mapping = {};
    Object.entries(aliases).forEach(([key, values]) => {
      mapping[key] = findColumn(headers, values);
    });
    return mapping;
  }

  function parseNumber(value) {
    if (value === null || value === undefined || value === "") return 0;
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const text = String(value).trim();
    if (!text || text === "-" || text.toLowerCase() === "n/a") return 0;
    const negative = /^\(.*\)$/.test(text);
    const cleaned = text.replace(/[,$%xX()\s]/g, "");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return 0;
    return negative ? -parsed : parsed;
  }

  function safeDivide(numerator, denominator) {
    return denominator ? numerator / denominator : 0;
  }

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function singularize(token) {
    if (token.length <= 3) return token;
    if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
    if (token.endsWith("sses")) return token.slice(0, -2);
    if (token.endsWith("xes") || token.endsWith("zes") || token.endsWith("ches") || token.endsWith("shes")) return token.slice(0, -2);
    if (token.endsWith("s") && !token.endsWith("ss") && !token.endsWith("us")) return token.slice(0, -1);
    return token;
  }

  function tokensForStem(value) {
    return normalizeText(value)
      .split(" ")
      .filter(Boolean)
      .filter((token) => !stopwords.has(token))
      .map(singularize);
  }

  function stemKey(value) {
    return [...tokensForStem(value)].sort().join(" ");
  }

  function getBrandTerms() {
    const raw = [$("brandName").value, $("brandTerms").value]
      .filter(Boolean)
      .join("\n")
      .split(/[\n,;]+/)
      .map(normalizeText)
      .filter(Boolean);
    return [...new Set(raw)];
  }

  function isBrandQuery(keyword, brandTerms) {
    if (!brandTerms.length) return false;
    const queryTokens = new Set(tokensForStem(keyword));
    const normalizedQuery = normalizeText(keyword);
    return brandTerms.some((term) => {
      const termTokens = tokensForStem(term);
      if (!termTokens.length) return false;
      if (termTokens.length === 1) return queryTokens.has(termTokens[0]);
      return termTokens.every((token) => queryTokens.has(token)) || normalizedQuery.includes(term);
    });
  }

  function monthFromWeek(value) {
    const text = String(value ?? "");
    const iso = text.match(/(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)/);
    if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, "0")}`;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}`;
    return "Unknown Month";
  }

  function monthLabel(value) {
    if (/^20\d{2}-\d{2}$/.test(value)) {
      const [year, month] = value.split("-").map(Number);
      return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
    }
    return value;
  }

  function periodSortValue(value) {
    const iso = String(value).match(/20\d{2}-\d{2}-\d{2}/);
    if (iso) return new Date(`${iso[0]}T00:00:00Z`).getTime();
    if (/^20\d{2}-\d{2}$/.test(value)) return new Date(`${value}-01T00:00:00Z`).getTime();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  async function parseFile(file) {
    if (!file) return [];
    const extension = file.name.split(".").pop().toLowerCase();
    if (extension === "csv") {
      if (typeof Papa === "undefined") throw new Error("The CSV reader could not load. Refresh the page and try again.");
      return new Promise((resolve, reject) => {
        Papa.parse(file, {
          header: true,
          skipEmptyLines: "greedy",
          transformHeader: (header) => header.replace(/^\uFEFF/, "").trim(),
          complete: (results) => {
            if (results.errors?.length && !results.data.length) reject(new Error(results.errors[0].message));
            else resolve(results.data);
          },
          error: reject,
        });
      });
    }
    if (typeof XLSX === "undefined") throw new Error("The Excel reader could not load. Refresh the page and try again.");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
  }

  function validateSearchMapping(mapping) {
    const required = ["campaign", "media", "keyword", "spend", "sales", "orders", "clicks", "impressions"];
    const missing = required.filter((key) => !mapping[key]);
    if (!mapping.week && !mapping.month) missing.push("week or month");
    return missing;
  }

  function prepareRows(rows, mapping) {
    return rows
      .map((row, index) => {
        const week = mapping.week ? String(row[mapping.week] ?? "").trim() : "";
        const rawMonth = mapping.month ? String(row[mapping.month] ?? "").trim() : "";
        const month = rawMonth || monthFromWeek(week);
        const keyword = String(row[mapping.keyword] ?? "").trim();
        return {
          _row: index + 2,
          account: mapping.account ? String(row[mapping.account] ?? "").trim() : "",
          week,
          month,
          campaign: String(row[mapping.campaign] ?? "").trim(),
          media: String(row[mapping.media] ?? "").trim(),
          keyword,
          spend: parseNumber(row[mapping.spend]),
          sales: parseNumber(row[mapping.sales]),
          orders: parseNumber(row[mapping.orders]),
          units: mapping.units ? parseNumber(row[mapping.units]) : 0,
          clicks: parseNumber(row[mapping.clicks]),
          impressions: parseNumber(row[mapping.impressions]),
        };
      })
      .filter((row) => row.keyword);
  }

  function prepareTargetRows(rows, mapping) {
    if (!mapping?.keyword) return [];
    return rows
      .map((row) => {
        const keyword = String(row[mapping.keyword] ?? "").trim();
        return {
          keyword,
          normalized: normalizeText(keyword),
          stem: stemKey(keyword),
          campaign: mapping.campaign ? String(row[mapping.campaign] ?? "").trim() : "",
          media: mapping.media ? String(row[mapping.media] ?? "").trim() : "",
          matchType: mapping.matchType ? String(row[mapping.matchType] ?? "").trim() : "",
          bid: mapping.bid ? parseNumber(row[mapping.bid]) : 0,
          status: mapping.status ? String(row[mapping.status] ?? "").trim() : "",
        };
      })
      .filter((row) => row.keyword);
  }

  function refreshPeriods() {
    const weeks = [...new Set(state.rows.map((row) => row.week).filter(Boolean))].sort((a, b) => periodSortValue(b) - periodSortValue(a));
    const months = [...new Set(state.rows.map((row) => row.month).filter(Boolean))].sort((a, b) => periodSortValue(b) - periodSortValue(a));
    state.periods = { weekly: weeks, monthly: months };

    if (!weeks.length && months.length) state.mode = "monthly";
    if (!months.length && weeks.length) state.mode = "weekly";
    updateModeButtons();
    populatePeriodSelect();
  }

  function updateModeButtons() {
    $("weeklyMode").classList.toggle("active", state.mode === "weekly");
    $("monthlyMode").classList.toggle("active", state.mode === "monthly");
    $("weeklyMode").disabled = state.rows.length > 0 && !state.periods.weekly.length;
    $("monthlyMode").disabled = state.rows.length > 0 && !state.periods.monthly.length;
  }

  function populatePeriodSelect(preferred) {
    const select = $("periodSelect");
    const periods = state.periods[state.mode] || [];
    select.innerHTML = "";
    if (!state.rows.length) {
      select.disabled = true;
      select.add(new Option("Upload a report first", ""));
      return;
    }
    select.disabled = false;
    select.add(new Option(`All Uploaded ${state.mode === "weekly" ? "Weeks" : "Months"}`, "__ALL__"));
    periods.forEach((period) => select.add(new Option(state.mode === "monthly" ? monthLabel(period) : period, period)));
    state.selectedPeriod = preferred && (preferred === "__ALL__" || periods.includes(preferred)) ? preferred : periods[0] || "__ALL__";
    select.value = state.selectedPeriod;
    [$("latestPeriod"), $("previousPeriod"), $("allPeriods")].forEach((button) => { button.disabled = !periods.length; });
  }

  function setStatus(message, isError = false) {
    const el = $("statusMessage");
    el.textContent = message;
    el.classList.toggle("error", isError);
  }

  function setGoal(goal) {
    if (goal === "unit" && !state.hasUnits && state.rows.length) {
      setStatus("Maximize Unit Sales is unavailable because the uploaded report does not include a Units column.", true);
      return;
    }
    state.goal = goal;
    $$(".goal-card").forEach((button) => button.classList.toggle("active", button.dataset.goal === goal));
    $("manualSortCard").hidden = goal !== "manual";
    updateGoalNote();

    if (goal === "manual") {
      $("oppAutoToggle").checked = false;
      $("ineffAutoToggle").checked = false;
      clearThresholds("opp");
      clearThresholds("ineff");
    } else {
      $("oppAutoToggle").checked = true;
      $("ineffAutoToggle").checked = true;
      applyAutoThresholds();
    }
    updateThresholdEditability();
  }

  function updateGoalNote() {
    const note = $("goalNote");
    if (state.goal === "revenue") {
      note.innerHTML = "<strong>Why ROAS is not an automatic filter:</strong> This lets terms with proven sales and order volume rise to the top without allowing a strict ROAS threshold to limit scaling opportunities. ROAS remains visible for context and can be added as a Manual guardrail.";
    } else if (state.goal === "unit") {
      note.innerHTML = "<strong>Unit-sales logic:</strong> The analyzer uses the selected period’s non-branded Unit CVR benchmark to identify terms capable of supporting unit velocity. Results are sorted by highest Unit CVR.";
    } else if (state.goal === "roas") {
      note.innerHTML = "<strong>Efficiency logic:</strong> Auto mode requires ROAS to be at least 15% above the selected period’s non-branded benchmark. Change the multiplier in Manual mode when needed.";
    } else {
      note.innerHTML = "<strong>Manual logic:</strong> Use fixed ROAS or CVR goals, benchmark-relative goals, or any combination of available minimums and ceilings.";
    }
    $("oppThresholdHelp").textContent = goalCopy[state.goal].note;
    $("ineffThresholdHelp").textContent = goalCopy[state.goal].ineff;
  }

  function clearThresholds(prefix) {
    const ids = prefix === "opp"
      ? ["oppMinClicks", "oppMinSpend", "oppMinSales", "oppMinOrders", "oppMinUnits", "oppRoasValue", "oppOrderCvrValue", "oppUnitCvrValue"]
      : ["ineffMinClicks", "ineffMinSpend", "ineffRoasValue", "ineffOrderCvrValue", "ineffUnitCvrValue"];
    ids.forEach((id) => { $(id).value = ""; });
    const modeIds = prefix === "opp"
      ? ["oppRoasMode", "oppOrderCvrMode", "oppUnitCvrMode"]
      : ["ineffRoasMode", "ineffOrderCvrMode", "ineffUnitCvrMode"];
    modeIds.forEach((id) => { $(id).value = "off"; });
  }

  function applyAutoThresholds() {
    if (!$("oppAutoToggle").checked && !$("ineffAutoToggle").checked) return;

    if ($("oppAutoToggle").checked) {
      $("oppMinClicks").value = 6;
      $("oppMinSpend").value = "";
      $("oppMinSales").value = "";
      $("oppMinOrders").value = 1;
      $("oppMinUnits").value = "";
      $("oppRoasMode").value = "off";
      $("oppRoasValue").value = "";
      $("oppOrderCvrMode").value = "off";
      $("oppOrderCvrValue").value = "";
      $("oppUnitCvrMode").value = "off";
      $("oppUnitCvrValue").value = "";

      if (state.goal === "unit") {
        $("oppMinUnits").value = 2;
        $("oppUnitCvrMode").value = "benchmark";
        $("oppUnitCvrValue").value = 100;
      } else if (state.goal === "revenue") {
        $("oppOrderCvrMode").value = "benchmark";
        $("oppOrderCvrValue").value = 100;
      } else if (state.goal === "roas") {
        $("oppRoasMode").value = "benchmark";
        $("oppRoasValue").value = 115;
      }
    }

    if ($("ineffAutoToggle").checked) {
      $("ineffMinClicks").value = 6;
      $("ineffMinSpend").value = "";
      $("ineffRoasMode").value = "off";
      $("ineffRoasValue").value = "";
      $("ineffOrderCvrMode").value = "off";
      $("ineffOrderCvrValue").value = "";
      $("ineffUnitCvrMode").value = "off";
      $("ineffUnitCvrValue").value = "";

      if (state.goal === "unit") {
        $("ineffUnitCvrMode").value = "benchmark";
        $("ineffUnitCvrValue").value = 50;
      } else if (state.goal === "revenue") {
        $("ineffOrderCvrMode").value = "benchmark";
        $("ineffOrderCvrValue").value = 50;
      } else if (state.goal === "roas") {
        $("ineffRoasMode").value = "benchmark";
        $("ineffRoasValue").value = 85;
      }
    }
  }

  function updateThresholdEditability() {
    const isManualGoal = state.goal === "manual";
    if (isManualGoal) {
      $("oppAutoToggle").checked = false;
      $("ineffAutoToggle").checked = false;
    }
    $("oppAutoToggle").disabled = isManualGoal;
    $("ineffAutoToggle").disabled = isManualGoal;
    const oppAuto = $("oppAutoToggle").checked;
    const ineffAuto = $("ineffAutoToggle").checked;
    $("oppModeLabel").textContent = oppAuto ? "AUTO" : "MANUAL";
    $("ineffModeLabel").textContent = ineffAuto ? "AUTO" : "MANUAL";

    ["oppMinClicks", "oppMinSpend", "oppMinSales", "oppMinOrders", "oppMinUnits", "oppRoasMode", "oppRoasValue", "oppOrderCvrMode", "oppOrderCvrValue", "oppUnitCvrMode", "oppUnitCvrValue"]
      .forEach((id) => { $(id).disabled = oppAuto; });
    ["ineffMinClicks", "ineffMinSpend", "ineffRoasMode", "ineffRoasValue", "ineffOrderCvrMode", "ineffOrderCvrValue", "ineffUnitCvrMode", "ineffUnitCvrValue"]
      .forEach((id) => { $(id).disabled = ineffAuto; });

    if (!state.hasUnits && state.rows.length) {
      ["oppMinUnits", "oppUnitCvrMode", "oppUnitCvrValue", "ineffUnitCvrMode", "ineffUnitCvrValue"].forEach((id) => { $(id).disabled = true; });
    }
  }

  function filterByPeriod(rows) {
    if (state.selectedPeriod === "__ALL__") return rows;
    const field = state.mode === "weekly" ? "week" : "month";
    return rows.filter((row) => row[field] === state.selectedPeriod);
  }

  function aggregateRows(rows, brandTerms) {
    const map = new Map();
    rows.forEach((row) => {
      const brand = isBrandQuery(row.keyword, brandTerms);
      if (brand && $("protectBrandTerms").checked) return;
      const key = stemKey(row.keyword) || normalizeText(row.keyword);
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, {
          stemKey: key,
          representative: normalizeText(row.keyword),
          spend: 0,
          sales: 0,
          orders: 0,
          units: 0,
          clicks: 0,
          impressions: 0,
          terms: new Map(),
          campaigns: new Set(),
          media: new Set(),
          brand,
        });
      }
      const item = map.get(key);
      item.spend += row.spend;
      item.sales += row.sales;
      item.orders += row.orders;
      item.units += row.units;
      item.clicks += row.clicks;
      item.impressions += row.impressions;
      if (row.campaign) item.campaigns.add(row.campaign);
      if (row.media) item.media.add(row.media);
      const termKey = normalizeText(row.keyword);
      const term = item.terms.get(termKey) || { term: termKey, spend: 0, sales: 0, orders: 0, units: 0, clicks: 0, impressions: 0 };
      term.spend += row.spend;
      term.sales += row.sales;
      term.orders += row.orders;
      term.units += row.units;
      term.clicks += row.clicks;
      term.impressions += row.impressions;
      item.terms.set(termKey, term);
    });

    return [...map.values()].map((item) => {
      const terms = [...item.terms.values()].sort((a, b) => b.sales - a.sales || b.orders - a.orders || b.clicks - a.clicks);
      item.representative = terms[0]?.term || item.representative;
      item.termCount = terms.length;
      item.contributingTerms = terms.map((term) => term.term);
      item.roas = safeDivide(item.sales, item.spend);
      item.orderCvr = safeDivide(item.orders, item.clicks);
      item.unitCvr = safeDivide(item.units, item.clicks);
      item.ctr = safeDivide(item.clicks, item.impressions);
      item.cpc = safeDivide(item.spend, item.clicks);
      return item;
    });
  }

  function calculateBenchmarks(rows, brandTerms) {
    const nonBrand = rows.filter((row) => !isBrandQuery(row.keyword, brandTerms));
    const totals = nonBrand.reduce((sum, row) => {
      sum.spend += row.spend;
      sum.sales += row.sales;
      sum.orders += row.orders;
      sum.units += row.units;
      sum.clicks += row.clicks;
      sum.impressions += row.impressions;
      return sum;
    }, { spend: 0, sales: 0, orders: 0, units: 0, clicks: 0, impressions: 0 });
    return {
      ...totals,
      roas: safeDivide(totals.sales, totals.spend),
      orderCvr: safeDivide(totals.orders, totals.clicks),
      unitCvr: safeDivide(totals.units, totals.clicks),
      ctr: safeDivide(totals.clicks, totals.impressions),
      cpc: safeDivide(totals.spend, totals.clicks),
      rowCount: nonBrand.length,
    };
  }

  function numberOrNull(id) {
    const value = $(id).value.trim();
    if (value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function metricThreshold(modeId, valueId, benchmark, isPercentMetric = false) {
    const mode = $(modeId).value;
    const value = numberOrNull(valueId);
    if (mode === "off" || value === null) return null;
    if (mode === "benchmark") return benchmark * (value / 100);
    return isPercentMetric ? value / 100 : value;
  }

  function readThresholds(benchmarks) {
    return {
      opportunity: {
        minClicks: numberOrNull("oppMinClicks"),
        minSpend: numberOrNull("oppMinSpend"),
        minSales: numberOrNull("oppMinSales"),
        minOrders: numberOrNull("oppMinOrders"),
        minUnits: numberOrNull("oppMinUnits"),
        minRoas: metricThreshold("oppRoasMode", "oppRoasValue", benchmarks.roas, false),
        minOrderCvr: metricThreshold("oppOrderCvrMode", "oppOrderCvrValue", benchmarks.orderCvr, true),
        minUnitCvr: metricThreshold("oppUnitCvrMode", "oppUnitCvrValue", benchmarks.unitCvr, true),
      },
      inefficiency: {
        minClicks: numberOrNull("ineffMinClicks"),
        minSpend: numberOrNull("ineffMinSpend"),
        maxRoas: metricThreshold("ineffRoasMode", "ineffRoasValue", benchmarks.roas, false),
        maxOrderCvr: metricThreshold("ineffOrderCvrMode", "ineffOrderCvrValue", benchmarks.orderCvr, true),
        maxUnitCvr: metricThreshold("ineffUnitCvrMode", "ineffUnitCvrValue", benchmarks.unitCvr, true),
      },
    };
  }

  function meetsMin(value, threshold) {
    return threshold === null || value >= threshold;
  }

  function meetsMax(value, threshold) {
    return threshold === null || value <= threshold;
  }

  function targetLookup() {
    const normalized = new Map();
    const stems = new Map();
    state.targetRows.forEach((row) => {
      if (!normalized.has(row.normalized)) normalized.set(row.normalized, row);
      if (!stems.has(row.stem)) stems.set(row.stem, row);
    });
    return { normalized, stems };
  }

  function findTargetMatch(item, lookup) {
    return lookup.normalized.get(normalizeText(item.representative)) || lookup.stems.get(item.stemKey) || null;
  }

  function opportunityReason(item, benchmarks) {
    if (state.goal === "unit") return `Unit CVR ${formatPercent(item.unitCvr)} vs. ${formatPercent(benchmarks.unitCvr)} non-branded benchmark; ${formatNumber(item.units)} units.`;
    if (state.goal === "revenue") return `${formatCurrency(item.sales)} in attributed sales and ${formatNumber(item.orders)} orders; Order CVR ${formatPercent(item.orderCvr)} vs. ${formatPercent(benchmarks.orderCvr)} benchmark.`;
    if (state.goal === "roas") return `${formatRoas(item.roas)} ROAS vs. ${formatRoas(benchmarks.roas)} non-branded benchmark.`;
    return "Meets all active manual opportunity guardrails.";
  }

  function inefficiencyReason(item, benchmarks) {
    if (state.goal === "unit") return `Unit CVR ${formatPercent(item.unitCvr)} vs. ${formatPercent(benchmarks.unitCvr)} non-branded benchmark.`;
    if (state.goal === "revenue") return `Order CVR ${formatPercent(item.orderCvr)} vs. ${formatPercent(benchmarks.orderCvr)} non-branded benchmark.`;
    if (state.goal === "roas") return `${formatRoas(item.roas)} ROAS vs. ${formatRoas(benchmarks.roas)} non-branded benchmark.`;
    return "Falls at or below every active manual inefficiency ceiling.";
  }

  function sortMetricForOpportunity() {
    if (state.goal === "unit") return "unitCvr";
    if (state.goal === "revenue") return "sales";
    if (state.goal === "roas") return "roas";
    return $("manualOpportunitySort").value;
  }

  function sortMetricForInefficiency() {
    if (state.goal === "unit") return "unitCvr";
    if (state.goal === "revenue") return "orderCvr";
    if (state.goal === "roas") return "roas";
    return $("manualIneffSort").value;
  }

  function analyze() {
    try {
      if (!state.rows.length) throw new Error("Upload a Search Term report first.");
      if (state.goal === "unit" && !state.hasUnits) throw new Error("Maximize Unit Sales requires a Units column in the uploaded report.");

      const brandTerms = getBrandTerms();
      const selectedRows = filterByPeriod(state.rows);
      if (!selectedRows.length) throw new Error("No rows were found for the selected reporting period.");

      const benchmarks = calculateBenchmarks(selectedRows, brandTerms);
      if (!benchmarks.clicks) throw new Error("The selected period does not contain non-branded clicks to analyze.");
      const thresholds = readThresholds(benchmarks);
      const aggregated = aggregateRows(selectedRows, brandTerms);
      const lookup = targetLookup();

      const opportunities = aggregated.filter((item) => {
        const t = thresholds.opportunity;
        return meetsMin(item.clicks, t.minClicks)
          && meetsMin(item.spend, t.minSpend)
          && meetsMin(item.sales, t.minSales)
          && meetsMin(item.orders, t.minOrders)
          && meetsMin(item.units, t.minUnits)
          && meetsMin(item.roas, t.minRoas)
          && meetsMin(item.orderCvr, t.minOrderCvr)
          && meetsMin(item.unitCvr, t.minUnitCvr);
      }).map((item) => {
        const target = findTargetMatch(item, lookup);
        return {
          ...item,
          target,
          action: target ? "Increase Bid" : (state.targetRows.length ? "Add as New Target" : "Add / Increase Bid Candidate"),
          reason: opportunityReason(item, benchmarks),
        };
      });

      const activeInefficiencyMetric = [thresholds.inefficiency.maxRoas, thresholds.inefficiency.maxOrderCvr, thresholds.inefficiency.maxUnitCvr].some((value) => value !== null);
      let inefficiencies = [];
      if (activeInefficiencyMetric) {
        inefficiencies = aggregated.filter((item) => {
          const t = thresholds.inefficiency;
          const basic = meetsMin(item.clicks, t.minClicks) && meetsMin(item.spend, t.minSpend);
          const ceiling = meetsMax(item.roas, t.maxRoas)
            && meetsMax(item.orderCvr, t.maxOrderCvr)
            && meetsMax(item.unitCvr, t.maxUnitCvr);
          const zeroOkay = $("includeZeroOrders").checked || item.orders > 0;
          return basic && ceiling && zeroOkay;
        }).map((item) => {
          const target = findTargetMatch(item, lookup);
          const zeroConversion = item.orders <= 0 && item.sales <= 0 && (!state.hasUnits || item.units <= 0);
          const action = zeroConversion || (!target && state.targetRows.length)
            ? "Add as Negative"
            : (target ? "Decrease Bid" : "Decrease Bid Candidate");
          return {
            ...item,
            target,
            action,
            negativeMatchType: $("exactNegatives").checked ? "Exact" : "Phrase / Exact Review",
            reason: inefficiencyReason(item, benchmarks),
          };
        });
      }

      const oppMetric = sortMetricForOpportunity();
      const ineffMetric = sortMetricForInefficiency();
      opportunities.sort((a, b) => (b[oppMetric] ?? 0) - (a[oppMetric] ?? 0) || b.sales - a.sales || b.clicks - a.clicks);
      inefficiencies.sort((a, b) => (a[ineffMetric] ?? 0) - (b[ineffMetric] ?? 0) || b.clicks - a.clicks || b.spend - a.spend);

      state.analysis = {
        brandTerms,
        selectedRows,
        benchmarks,
        thresholds,
        opportunities,
        inefficiencies,
        opportunitySort: oppMetric,
        inefficiencySort: ineffMetric,
        selectedPeriodLabel: state.selectedPeriod === "__ALL__" ? `All Uploaded ${state.mode === "weekly" ? "Weeks" : "Months"}` : (state.mode === "monthly" ? monthLabel(state.selectedPeriod) : state.selectedPeriod),
      };

      renderResults();
      setStatus(`Analysis complete: ${formatNumber(opportunities.length)} opportunities and ${formatNumber(inefficiencies.length)} inefficiencies.`, false);
      $("resultsSection").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setStatus(error.message || "Unable to complete the analysis.", true);
    }
  }

  function formatNumber(value, decimals = 0) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value || 0);
  }
  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value || 0);
  }
  function formatPercent(value) {
    return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value || 0);
  }
  function formatRoas(value) {
    return `${formatNumber(value || 0, 2)}x`;
  }

  function renderResults() {
    const { benchmarks, opportunities, inefficiencies, selectedPeriodLabel } = state.analysis;
    $("resultsSection").hidden = false;
    $("oppCount").textContent = opportunities.length;
    $("ineffCount").textContent = inefficiencies.length;
    $("resultsSummary").textContent = `${selectedPeriodLabel} · ${goalLabel(state.goal)} · Full qualifying lists included.`;
    $("benchmarkStrip").innerHTML = [
      ["Non-Branded ROAS", formatRoas(benchmarks.roas)],
      ["Non-Branded Order CVR", formatPercent(benchmarks.orderCvr)],
      ["Non-Branded Unit CVR", state.hasUnits ? formatPercent(benchmarks.unitCvr) : "Not available"],
      ["Non-Branded Clicks", formatNumber(benchmarks.clicks)],
    ].map(([label, value]) => `<div class="benchmark-box"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");

    renderTable("opportunityTable", opportunities, "opportunity");
    renderTable("inefficiencyTable", inefficiencies, "inefficiency");
    renderSettings();
  }

  function tableColumns(type) {
    const base = [
      ["action", "Recommendation"],
      ["representative", "Stemmed Search Term"],
      ["termCount", "Raw Terms"],
      ["clicks", "Clicks"],
      ["orders", "Orders"],
      ["units", "Units"],
      ["sales", "Sales"],
      ["spend", "Spend"],
      ["roas", "ROAS"],
      ["orderCvr", "Order CVR"],
      ["unitCvr", "Unit CVR"],
      ["ctr", "CTR"],
      ["cpc", "CPC"],
      ["reason", "Why It Qualified"],
    ];
    if (type === "inefficiency") base.splice(1, 0, ["negativeMatchType", "Negative Match"]);
    return base;
  }

  function renderTable(tableId, rows, type, filter = "") {
    const table = $(tableId);
    const query = normalizeText(filter);
    const filtered = query ? rows.filter((row) => normalizeText(`${row.representative} ${row.contributingTerms.join(" ")} ${row.action}`).includes(query)) : rows;
    const columns = tableColumns(type);
    const head = `<thead><tr>${columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}</tr></thead>`;
    const bodyRows = filtered.map((row) => `<tr>${columns.map(([key]) => `<td>${renderCell(key, row[key])}</td>`).join("")}</tr>`).join("");
    table.innerHTML = `${head}<tbody>${bodyRows || `<tr><td colspan="${columns.length}">No qualifying rows.</td></tr>`}</tbody>`;
    const showing = type === "opportunity" ? $("oppShowing") : $("ineffShowing");
    showing.textContent = `Showing ${formatNumber(filtered.length)} of ${formatNumber(rows.length)}`;
  }

  function renderCell(key, value) {
    if (key === "action") return `<span class="action-badge">${escapeHtml(value || "")}</span>`;
    if (["sales", "spend", "cpc"].includes(key)) return escapeHtml(formatCurrency(value));
    if (["roas"].includes(key)) return escapeHtml(formatRoas(value));
    if (["orderCvr", "unitCvr", "ctr"].includes(key)) return escapeHtml(formatPercent(value));
    if (["clicks", "orders", "units", "termCount"].includes(key)) return escapeHtml(formatNumber(value));
    return escapeHtml(String(value ?? ""));
  }

  function renderSettings() {
    const { benchmarks, thresholds, brandTerms, selectedPeriodLabel, opportunitySort, inefficiencySort } = state.analysis;
    const items = [
      ["Goal", goalLabel(state.goal)],
      ["Reporting Period", selectedPeriodLabel],
      ["Brand Terms Protected", brandTerms.length ? brandTerms.join(", ") : "None entered"],
      ["Opportunity Mode", $("oppAutoToggle").checked ? "Auto" : "Manual"],
      ["Inefficiency Mode", $("ineffAutoToggle").checked ? "Auto" : "Manual"],
      ["Opportunity Sort", metricLabel(opportunitySort) + " — highest to lowest"],
      ["Inefficiency Sort", metricLabel(inefficiencySort) + " — lowest to highest"],
      ["Non-Branded ROAS", formatRoas(benchmarks.roas)],
      ["Non-Branded Order CVR", formatPercent(benchmarks.orderCvr)],
      ["Non-Branded Unit CVR", state.hasUnits ? formatPercent(benchmarks.unitCvr) : "Not available"],
      ["Opportunity Filters", summarizeOpportunityThresholds(thresholds.opportunity)],
      ["Inefficiency Filters", summarizeInefficiencyThresholds(thresholds.inefficiency)],
    ];
    $("settingsGrid").innerHTML = items.map(([label, value]) => `<div class="setting-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  }

  function summarizeOpportunityThresholds(t) {
    const list = [];
    if (t.minClicks !== null) list.push(`Clicks ≥ ${t.minClicks}`);
    if (t.minSpend !== null) list.push(`Spend ≥ ${formatCurrency(t.minSpend)}`);
    if (t.minSales !== null) list.push(`Sales ≥ ${formatCurrency(t.minSales)}`);
    if (t.minOrders !== null) list.push(`Orders ≥ ${t.minOrders}`);
    if (t.minUnits !== null) list.push(`Units ≥ ${t.minUnits}`);
    if (t.minRoas !== null) list.push(`ROAS ≥ ${formatRoas(t.minRoas)}`);
    if (t.minOrderCvr !== null) list.push(`Order CVR ≥ ${formatPercent(t.minOrderCvr)}`);
    if (t.minUnitCvr !== null) list.push(`Unit CVR ≥ ${formatPercent(t.minUnitCvr)}`);
    return list.join("; ") || "No active filters";
  }

  function summarizeInefficiencyThresholds(t) {
    const list = [];
    if (t.minClicks !== null) list.push(`Clicks ≥ ${t.minClicks}`);
    if (t.minSpend !== null) list.push(`Spend ≥ ${formatCurrency(t.minSpend)}`);
    if (t.maxRoas !== null) list.push(`ROAS ≤ ${formatRoas(t.maxRoas)}`);
    if (t.maxOrderCvr !== null) list.push(`Order CVR ≤ ${formatPercent(t.maxOrderCvr)}`);
    if (t.maxUnitCvr !== null) list.push(`Unit CVR ≤ ${formatPercent(t.maxUnitCvr)}`);
    return list.join("; ") || "No active performance ceiling";
  }

  function goalLabel(goal) {
    return ({ unit: "Maximize Unit Sales", revenue: "Maximize Revenue", roas: "Maximize ROAS", manual: "Custom / Manual" })[goal] || goal;
  }

  function metricLabel(metric) {
    return ({ sales: "Sales", roas: "ROAS", orders: "Orders", units: "Units", orderCvr: "Order CVR", unitCvr: "Unit CVR", clicks: "Clicks", spend: "Spend" })[metric] || metric;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function exportRow(item, rank, type) {
    return {
      Rank: rank,
      "Stemmed Search Term": item.representative,
      "Recommended Action": item.action,
      "Negative Match Type": type === "inefficiency" ? item.negativeMatchType : "",
      "Contributing Search Terms": item.contributingTerms.join(" | "),
      "Search Term Count": item.termCount,
      Campaigns: [...item.campaigns].join(" | "),
      "Media Names": [...item.media].join(" | "),
      Clicks: item.clicks,
      Impressions: item.impressions,
      Spend: Number(item.spend.toFixed(2)),
      Sales: Number(item.sales.toFixed(2)),
      Orders: item.orders,
      Units: item.units,
      ROAS: Number(item.roas.toFixed(4)),
      "Order CVR": Number(item.orderCvr.toFixed(6)),
      "Unit CVR": Number(item.unitCvr.toFixed(6)),
      CTR: Number(item.ctr.toFixed(6)),
      CPC: Number(item.cpc.toFixed(4)),
      "Matched Existing Target": item.target?.keyword || "",
      "Current Bid": item.target?.bid || "",
      "Current Match Type": item.target?.matchType || "",
      "Why It Qualified": item.reason,
    };
  }

  function settingsExportRows() {
    const a = state.analysis;
    return [
      { Setting: "Optimization Goal", Value: goalLabel(state.goal) },
      { Setting: "Reporting Period", Value: a.selectedPeriodLabel },
      { Setting: "Opportunity Mode", Value: $("oppAutoToggle").checked ? "Auto" : "Manual" },
      { Setting: "Inefficiency Mode", Value: $("ineffAutoToggle").checked ? "Auto" : "Manual" },
      { Setting: "Brand Terms Protected", Value: a.brandTerms.join(", ") || "None entered" },
      { Setting: "Non-Branded Spend", Value: Number(a.benchmarks.spend.toFixed(2)) },
      { Setting: "Non-Branded Sales", Value: Number(a.benchmarks.sales.toFixed(2)) },
      { Setting: "Non-Branded Clicks", Value: a.benchmarks.clicks },
      { Setting: "Non-Branded Orders", Value: a.benchmarks.orders },
      { Setting: "Non-Branded Units", Value: a.benchmarks.units },
      { Setting: "Non-Branded ROAS", Value: Number(a.benchmarks.roas.toFixed(4)) },
      { Setting: "Non-Branded Order CVR", Value: Number(a.benchmarks.orderCvr.toFixed(6)) },
      { Setting: "Non-Branded Unit CVR", Value: state.hasUnits ? Number(a.benchmarks.unitCvr.toFixed(6)) : "Not available" },
      { Setting: "Opportunity Filters", Value: summarizeOpportunityThresholds(a.thresholds.opportunity) },
      { Setting: "Inefficiency Filters", Value: summarizeInefficiencyThresholds(a.thresholds.inefficiency) },
      { Setting: "Opportunity Sort", Value: `${metricLabel(a.opportunitySort)} — highest to lowest` },
      { Setting: "Inefficiency Sort", Value: `${metricLabel(a.inefficiencySort)} — lowest to highest` },
      { Setting: "Benchmark Multiplier Explanation", Value: "Required threshold = non-branded benchmark × multiplier. Benchmarks are recalculated from summed non-branded performance in the selected period." },
    ];
  }

  function styleWorksheet(sheet, widths) {
    sheet["!cols"] = widths.map((wch) => ({ wch }));
    sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  }

  function downloadResults() {
    if (!state.analysis) return;
    if (typeof XLSX === "undefined") {
      setStatus("The Excel exporter could not load. Refresh the page and try again.", true);
      return;
    }
    const workbook = XLSX.utils.book_new();
    const oppRows = state.analysis.opportunities.map((item, index) => exportRow(item, index + 1, "opportunity"));
    const ineffRows = state.analysis.inefficiencies.map((item, index) => exportRow(item, index + 1, "inefficiency"));
    const settingsRows = settingsExportRows();

    const oppSheet = XLSX.utils.json_to_sheet(oppRows.length ? oppRows : [{ Message: "No qualifying opportunity keywords." }]);
    const ineffSheet = XLSX.utils.json_to_sheet(ineffRows.length ? ineffRows : [{ Message: "No qualifying inefficiencies." }]);
    const settingsSheet = XLSX.utils.json_to_sheet(settingsRows);
    styleWorksheet(oppSheet, [8, 34, 24, 20, 70, 16, 40, 34, 12, 14, 14, 14, 12, 12, 12, 14, 14, 12, 12, 30, 14, 18, 70]);
    styleWorksheet(ineffSheet, [8, 34, 24, 20, 70, 16, 40, 34, 12, 14, 14, 14, 12, 12, 12, 14, 14, 12, 12, 30, 14, 18, 70]);
    styleWorksheet(settingsSheet, [34, 90]);

    XLSX.utils.book_append_sheet(workbook, oppSheet, "Opportunity Keywords");
    XLSX.utils.book_append_sheet(workbook, ineffSheet, "Inefficiencies");
    XLSX.utils.book_append_sheet(workbook, settingsSheet, "Settings & Benchmarks");

    const safePeriod = state.analysis.selectedPeriodLabel.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    XLSX.writeFile(workbook, `TPA_Search_Opportunity_Analysis_${safePeriod || "report"}.xlsx`);
  }

  function downloadTemplate() {
    if (typeof XLSX === "undefined") {
      setStatus("The Excel template generator could not load. Refresh the page and try again.", true);
      return;
    }
    const workbook = XLSX.utils.book_new();
    const searchTemplate = [{
      "Account Name": "Example Brand – RMS",
      Week: "2026-06-07 to 2026-06-13",
      Month: "2026-06",
      "Campaign Name": "Example Campaign",
      "Media Name": "Example Line Item",
      Keyword: "example search term",
      "Actualized Vendor Spend": 25,
      "Attributed Total Sales": 75,
      "Attributed Total Orders": 3,
      "Attributed Total Units": 4,
      Clicks: 12,
      Impressions: 800,
    }];
    const targetTemplate = [{
      "Campaign Name": "Example Campaign",
      "Media Name": "Example Line Item",
      Keyword: "example search term",
      "Match Type": "Exact",
      "Current Bid": 1.5,
      Status: "Active",
    }];
    const searchSheet = XLSX.utils.json_to_sheet(searchTemplate);
    const targetSheet = XLSX.utils.json_to_sheet(targetTemplate);
    styleWorksheet(searchSheet, [24, 26, 14, 28, 26, 32, 20, 22, 22, 22, 12, 14]);
    styleWorksheet(targetSheet, [28, 26, 32, 14, 14, 14]);
    XLSX.utils.book_append_sheet(workbook, searchSheet, "Search Term Template");
    XLSX.utils.book_append_sheet(workbook, targetSheet, "Current Targets Template");
    XLSX.writeFile(workbook, "TPA_Search_Term_Analyzer_Template.xlsx");
  }

  async function handleSearchFile(file) {
    try {
      setStatus("Reading Search Term report…");
      const raw = await parseFile(file);
      const mapping = mapColumns(raw, columnAliases);
      const missing = validateSearchMapping(mapping);
      if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}.`);
      state.searchFile = file;
      state.mapped = mapping;
      state.rows = prepareRows(raw, mapping);
      state.hasUnits = Boolean(mapping.units);
      if (!state.rows.length) throw new Error("The uploaded file did not contain any usable keyword rows.");
      $("searchFileName").textContent = `${file.name} · ${formatNumber(state.rows.length)} rows`;
      $("analyzeButton").disabled = false;
      $("goalGrid").querySelector('[data-goal="unit"]').disabled = !state.hasUnits;
      if (!state.hasUnits && state.goal === "unit") setGoal("revenue");
      refreshPeriods();
      applyAutoThresholds();
      updateThresholdEditability();
      setStatus(`${file.name} loaded. ${state.hasUnits ? "Units detected." : "Units not detected; Unit Sales goal is disabled."}`);
    } catch (error) {
      state.rows = [];
      state.searchFile = null;
      $("analyzeButton").disabled = true;
      $("searchFileName").textContent = "CSV or XLSX";
      setStatus(error.message || "Unable to read the Search Term report.", true);
    }
  }

  async function handleTargetFile(file) {
    try {
      setStatus("Reading Current Keyword / Target report…");
      const raw = await parseFile(file);
      const mapping = mapColumns(raw, targetAliases);
      if (!mapping.keyword) throw new Error("The optional target report needs a Keyword or Target column.");
      state.targetFile = file;
      state.targetMapped = mapping;
      state.targetRows = prepareTargetRows(raw, mapping);
      $("targetFileName").textContent = `${file.name} · ${formatNumber(state.targetRows.length)} targets`;
      setStatus(`${file.name} loaded. Existing target matching is enabled.`);
    } catch (error) {
      state.targetRows = [];
      state.targetFile = null;
      $("targetFileName").textContent = "CSV or XLSX";
      setStatus(error.message || "Unable to read the target report.", true);
    }
  }

  function setupDropzone(dropzoneId, inputId, handler) {
    const dropzone = $(dropzoneId);
    const input = $(inputId);
    ["dragenter", "dragover"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragover");
    }));
    ["dragleave", "drop"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragover");
    }));
    dropzone.addEventListener("drop", (event) => {
      const file = event.dataTransfer.files[0];
      if (file) handler(file);
    });
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (file) handler(file);
    });
  }

  function setupEvents() {
    setupDropzone("searchDropzone", "searchFile", handleSearchFile);
    setupDropzone("targetDropzone", "targetFile", handleTargetFile);

    $$(".goal-card").forEach((button) => button.addEventListener("click", () => setGoal(button.dataset.goal)));
    $("oppAutoToggle").addEventListener("change", () => {
      if ($("oppAutoToggle").checked && state.goal !== "manual") applyAutoThresholds();
      updateThresholdEditability();
    });
    $("ineffAutoToggle").addEventListener("change", () => {
      if ($("ineffAutoToggle").checked && state.goal !== "manual") applyAutoThresholds();
      updateThresholdEditability();
    });

    $("weeklyMode").addEventListener("click", () => {
      state.mode = "weekly";
      updateModeButtons();
      populatePeriodSelect();
    });
    $("monthlyMode").addEventListener("click", () => {
      state.mode = "monthly";
      updateModeButtons();
      populatePeriodSelect();
    });
    $("periodSelect").addEventListener("change", () => { state.selectedPeriod = $("periodSelect").value; });
    $("latestPeriod").addEventListener("click", () => {
      const periods = state.periods[state.mode];
      if (periods.length) {
        state.selectedPeriod = periods[0];
        $("periodSelect").value = state.selectedPeriod;
      }
    });
    $("previousPeriod").addEventListener("click", () => {
      const periods = state.periods[state.mode];
      if (periods.length > 1) {
        state.selectedPeriod = periods[1];
        $("periodSelect").value = state.selectedPeriod;
      }
    });
    $("allPeriods").addEventListener("click", () => {
      state.selectedPeriod = "__ALL__";
      $("periodSelect").value = "__ALL__";
    });

    $("analyzeButton").addEventListener("click", analyze);
    $("downloadResults").addEventListener("click", downloadResults);
    $("downloadTemplate").addEventListener("click", downloadTemplate);

    $$(".result-tab").forEach((button) => button.addEventListener("click", () => {
      $$(".result-tab").forEach((item) => item.classList.toggle("active", item === button));
      const target = button.dataset.tab;
      ["opportunities", "inefficiencies", "settings"].forEach((name) => {
        const panel = $(`${name}Panel`);
        panel.hidden = name !== target;
        panel.classList.toggle("active", name === target);
      });
    }));

    $("oppSearch").addEventListener("input", () => {
      if (state.analysis) renderTable("opportunityTable", state.analysis.opportunities, "opportunity", $("oppSearch").value);
    });
    $("ineffSearch").addEventListener("input", () => {
      if (state.analysis) renderTable("inefficiencyTable", state.analysis.inefficiencies, "inefficiency", $("ineffSearch").value);
    });
  }

  setupEvents();
  updateGoalNote();
  applyAutoThresholds();
  updateThresholdEditability();
})();
