// Global state to store grouped bookmarks
window.allBookmarks = {};

/**
 * Traverses the bookmark tree and groups items by hostname.
 * Automatically called on script load.
 */
function groupBookmarks() {
    console.clear();
    console.log("Indexing bookmarks...");

    browser.bookmarks.getTree().then((roots) => {
        let groups = {};
        let totalBookmarksCount = 0;
        
        function traverse(node) {
            if (node.url) {
                totalBookmarksCount++;
                try {
                    let urlObj = new URL(node.url);
                    let domain = urlObj.hostname.replace(/^www\./, '');
                    
                    if (!groups[domain]) groups[domain] = [];
                    groups[domain].push({
                        id: node.id,
                        title: node.title,
                        url: node.url,
                        dateAdded: node.dateAdded || 0
                    });
                } catch (e) {
                    // Ignore invalid URLs
                }
            }
            if (node.children) {
                for (let child of node.children) traverse(child);
            }
        }

        traverse(roots[0]);
        window.allBookmarks = groups;

        const totalDomains = Object.keys(groups).length;
        console.log(`%c [STATUS] Ready `, "background: #0078d7; color: white; font-weight: bold;");
        console.log(`Total Bookmarks: ${totalBookmarksCount}`);
        console.log(`Unique Domains:  ${totalDomains}`);

        // 2. Run Folder Analysis immediately to show current state
        analyzeFolders(roots);
    });
}

/**
 * Scans for folders and counts bookmarks inside them directly.
 */
function analyzeFolders(roots = null) {
    // If roots not provided (called manually), fetch tree first
    if (!roots) {
        browser.bookmarks.getTree().then(r => analyzeFolders(r));
        return;
    }

    let folderStats = [];

    function traverseFolders(node) {
        // If it's a folder (has children array and no URL)
        if (!node.url && node.children) {
            // Count direct children that are bookmarks (have URL)
            let directBookmarks = node.children.filter(c => c.url).length;
            
            // Only list folders that contain something, or are root folders
            if (directBookmarks > 0 || node.id === "menu________" || node.id === "toolbar_____") {
                folderStats.push({
                    "Folder Name": node.title || "[Root/Unnamed]",
                    "Bookmark Count": directBookmarks
                });
            }

            // Go deeper
            for (let child of node.children) traverseFolders(child);
        }
    }

    traverseFolders(roots[0]);

    // Sort by count desc
    folderStats.sort((a, b) => b["Bookmark Count"] - a["Bookmark Count"]);

    console.groupCollapsed("📂 FOLDER REPORT (Click to expand)");
    console.table(folderStats);
    console.groupEnd();
}

/**
 * Formats the output string for the clipboard.
 * Format:
 * === Domain (Count) ===
 * [Date] [Title]
 * URL
 */
function formatOutput(domains) {
    let output = "";
    domains.forEach(domain => {
        const items = window.allBookmarks[domain];
        output += `\n=== ${domain} (${items.length}) ===\n`;
        
        items.forEach(b => {
            const dateStr = new Date(b.dateAdded).toLocaleDateString();
            output += `[${dateStr}] [${b.title || 'No Title'}]\n${b.url}\n`;
        });
    });
    return output;
}

/**
 * Helper: Filters a list of domains based on input strings and mode.
 */
function filterResults(domains, filterList, strictMode) {
    if (!filterList || filterList.length === 0) return domains;

    return domains.filter(domain => {
        return filterList.some(filterStr => {
            return strictMode ? domain === filterStr : domain.includes(filterStr);
        });
    });
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        console.log("%c COPIED TO CLIPBOARD ", "background: green; color: white; padding: 2px; border-radius: 4px;");
    }).catch(err => {
        console.error("Clipboard Error:", err);
    });
}

async function getOrCreateFolder(folderName) {
    const searchResults = await browser.bookmarks.search({ title: folderName });
    const existingFolder = searchResults.find(node => !node.url);

    if (existingFolder) {
        return existingFolder.id;
    } else {
        const newFolder = await browser.bookmarks.create({
            title: folderName,
            index: 0
        });
        return newFolder.id;
    }
}

// ==========================================
// Public Console API
// ==========================================

/**
 * Lists domains with an exact number of bookmarks.
 * @param {number} n - Exact count.
 * @param {string[]} [filters] - Optional filter strings.
 * @param {boolean} [strict] - strict mode for filters.
 * @param {string} [bookmarkSort='asc'] - 'asc' (Oldest->Newest) or 'desc' (Newest->Oldest).
 * @returns {string[]} Array of matching domains.
 */
window.listByExactCount = function(n, filters = [], strict = false, bookmarkSort = 'asc') {
    if (!window.allBookmarks) return console.error("Error: No data loaded. Reload extension.");

    let matches = Object.keys(window.allBookmarks).filter(d => window.allBookmarks[d].length === n);
    
    if (matches.length === 0) {
        console.warn(`No domains found with exactly ${n} bookmarks.`);
        return [];
    }

    matches = filterResults(matches, filters, strict);

    if (matches.length === 0) {
        console.warn(`No results after filtering.`);
        return [];
    }

    // Sort Domains: Alphabetical (counts are identical)
    matches.sort();

    // Sort Bookmarks inside domains
    matches.forEach(domain => {
        if (bookmarkSort === 'desc') {
            window.allBookmarks[domain].sort((a, b) => b.dateAdded - a.dateAdded);
        } else {
            window.allBookmarks[domain].sort((a, b) => a.dateAdded - b.dateAdded);
        }
    });

    console.log(`Found ${matches.length} domains. Bookmarks sorted: ${bookmarkSort}. Copying...`);
    copyToClipboard(formatOutput(matches));
    
    matches.forEach(d => {
        console.groupCollapsed(`${d} (${n})`);
        console.table(window.allBookmarks[d], ["title", "url"]);
        console.groupEnd();
    });

    return matches;
};

/**
 * Lists domains within a bookmark count range.
 * @param {number} min 
 * @param {number} max 
 * @param {string[]} filters 
 * @param {boolean} strict 
 * @param {string} [bookmarkSort='asc'] - 'asc' (Oldest->Newest) or 'desc' (Newest->Oldest).
 * @returns {string[]} Array of matching domains.
 */
window.listByRangeCount = function(min, max, filters = [], strict = false, bookmarkSort = 'asc') {
    if (!window.allBookmarks) return console.error("Error: No data loaded. Reload extension.");

    let matches = Object.keys(window.allBookmarks).filter(d => {
        let len = window.allBookmarks[d].length;
        return len >= min && len <= max;
    });

    if (matches.length === 0) {
        console.warn(`No domains found in range ${min}-${max}.`);
        return [];
    }

    matches = filterResults(matches, filters, strict);

    if (matches.length === 0) {
        console.warn(`No results after filtering.`);
        return [];
    }

    // 1. Sort DOMAINS: Always Descending by count (Largest first)
    matches.sort((a, b) => window.allBookmarks[b].length - window.allBookmarks[a].length);

    // 2. Sort BOOKMARKS (Links inside domain)
    matches.forEach(domain => {
        if (bookmarkSort === 'desc') {
            // Newest -> Oldest
            window.allBookmarks[domain].sort((a, b) => b.dateAdded - a.dateAdded);
        } else {
            // Oldest -> Newest (Default)
            window.allBookmarks[domain].sort((a, b) => a.dateAdded - b.dateAdded);
        }
    });

    console.log(`Found ${matches.length} domains. Bookmarks sorted: ${bookmarkSort}. Copying...`);
    copyToClipboard(formatOutput(matches));
    
    matches.forEach(d => {
        let count = window.allBookmarks[d].length;
        console.groupCollapsed(`[${count}] ${d}`);
        console.table(window.allBookmarks[d], ["title", "url"]);
        console.groupEnd();
    });

    return matches;
};

window.moveDomainsToFolder = async function(domains, folderName) {
    if (!domains || domains.length === 0) return console.warn("No domains provided to move.");
    if (!window.allBookmarks) return console.error("No data loaded.");

    console.log(`Preparing to move bookmarks from ${domains.length} domains to folder: "${folderName}"...`);

    try {
        const targetFolderId = await getOrCreateFolder(folderName);
        let moveCount = 0;

        for (const domain of domains) {
            const bookmarks = window.allBookmarks[domain];
            if (!bookmarks) continue;

            for (const bookmark of bookmarks) {
                await browser.bookmarks.move(bookmark.id, { parentId: targetFolderId });
                moveCount++;
            }
        }

        console.log(`%c SUCCESS `, "background: green; color: white; font-weight: bold;");
        console.log(`Moved ${moveCount} bookmarks from ${domains.length} domains to folder "${folderName}".`);
        groupBookmarks();

    } catch (err) {
        console.error("Error moving bookmarks:", err);
    }
};

/**
 * Deletes bookmarks for specified domains.
 * @param {string} domainInput - Domain name to delete.
 * @param {string} mode - Deletion mode:
 * - 'exact' (DEFAULT): Deletes ONLY exact match (e.g. 'google.com' keeps 'maps.google.com').
 * - 'tree': Deletes exact match AND subdomains (e.g. 'google.com' deletes 'maps.google.com' too).
 * - 'loose': Deletes anything containing the string (e.g. 'google' deletes 'fwgoogle.com').
 */
window.deleteDomain = function(domainInput, mode = 'exact') {
    if (!window.allBookmarks) return console.error("Error: No data loaded.");

    let targetDomains = [];
    const normalizedMode = mode.toLowerCase();

    // Logic Switch
    if (normalizedMode === 'exact') {
        // 1. Exact Match Only (Default)
        if (window.allBookmarks[domainInput]) {
            targetDomains = [domainInput];
        }
    } 
    else if (normalizedMode === 'tree') {
        // 2. Tree/Subdomain Match
        targetDomains = Object.keys(window.allBookmarks).filter(d => {
            return d === domainInput || d.endsWith('.' + domainInput);
        });
    } 
    else if (normalizedMode === 'loose') {
        // 3. Loose/Search Match
        targetDomains = Object.keys(window.allBookmarks).filter(d => d.includes(domainInput));
    } 
    else {
        return console.error(`Invalid mode: '${mode}'. Use 'exact', 'tree', or 'loose'.`);
    }

    if (targetDomains.length === 0) {
        return console.warn(`No domains found for input: "${domainInput}" (Mode: ${normalizedMode})`);
    }

    console.log(`Deleting bookmarks for ${targetDomains.length} domains (Mode: ${normalizedMode})...`);
    console.log("Targets:", targetDomains);
    
    let count = 0;
    targetDomains.forEach(domain => {
        window.allBookmarks[domain].forEach(bookmark => {
            browser.bookmarks.remove(bookmark.id);
            count++;
        });
        delete window.allBookmarks[domain];
    });

    console.log(`SUCCESS: Deleted ${count} bookmarks.`);
};

// Initialize
groupBookmarks();