/**
 * SkinService - Resolves Minecraft player skins using Mojang Session Server API
 * 
 * Features:
 * - Uses official Mojang Session Server API
 * - In-memory caching (6 hours per UUID)
 * - Supports both Steve (classic) and Alex (slim) models
 * - Graceful error handling
 * - Prevents duplicate concurrent fetches
 */

class SkinService {
    constructor() {
        // Cache structure: { uuid: { skinUrl, model, timestamp } }
        this.cache = new Map();
        
        // Pending fetches to prevent duplicates: { uuid: Promise }
        this.pendingFetches = new Map();
        
        // Cache duration: 6 hours
        this.CACHE_DURATION_MS = 6 * 60 * 60 * 1000;
        
        // Request timeout: 5 seconds
        this.FETCH_TIMEOUT_MS = 5000;
        
        // Mojang Session Server URL
        this.SESSION_SERVER_URL = 'https://sessionserver.mojang.com/session/minecraft/profile';
        
        // Default Steve skin (fallback)
        this.DEFAULT_SKIN = {
            skinUrl: 'https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb',
            model: 'default' // default = Steve (classic), slim = Alex
        };
    }

    /**
     * Get skin data for a player UUID
     * @param {string} uuid - Player UUID (with or without dashes)
     * @returns {Promise<{skinUrl: string, model: string}>}
     */
    async getSkin(uuid) {
        // Normalize UUID (remove dashes)
        const normalizedUuid = uuid.replace(/-/g, '');
        
        // Check cache first
        const cached = this.cache.get(normalizedUuid);
        if (cached) {
            const age = Date.now() - cached.timestamp;
            if (age < this.CACHE_DURATION_MS) {
                return { skinUrl: cached.skinUrl, model: cached.model };
            }
            // Cache expired, remove it
            this.cache.delete(normalizedUuid);
        }
        
        // Check if fetch is already in progress
        const pending = this.pendingFetches.get(normalizedUuid);
        if (pending) {
            return await pending;
        }
        
        // Start new fetch
        const fetchPromise = this._fetchSkinFromMojang(normalizedUuid);
        this.pendingFetches.set(normalizedUuid, fetchPromise);
        
        try {
            const result = await fetchPromise;
            return result;
        } finally {
            // Clean up pending fetch
            this.pendingFetches.delete(normalizedUuid);
        }
    }

    /**
     * Fetch skin data from Mojang Session Server
     * @private
     */
    async _fetchSkinFromMojang(uuid) {
        try {
            // Create AbortController for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT_MS);
            
            // Fetch profile from Mojang Session Server
            const url = `${this.SESSION_SERVER_URL}/${uuid}?unsigned=false`;
            const response = await fetch(url, { 
                signal: controller.signal,
                headers: {
                    'User-Agent': 'McGPS-Telemetry/1.0'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                if (response.status === 429) {
                    console.warn(`Rate limited by Mojang API for UUID ${uuid}`);
                } else if (response.status === 404) {
                    console.warn(`Player not found in Mojang database: ${uuid}`);
                } else {
                    console.error(`Mojang API error ${response.status} for UUID ${uuid}`);
                }
                return this._cacheAndReturn(uuid, this.DEFAULT_SKIN);
            }
            
            const responseText = await response.text();
            
            // Parse JSON safely
            let profile;
            try {
                profile = JSON.parse(responseText);
            } catch (parseError) {
                console.error(`Failed to parse Mojang API response for ${uuid}:`, parseError.message);
                console.error(`Response text: ${responseText.substring(0, 200)}`);
                return this._cacheAndReturn(uuid, this.DEFAULT_SKIN);
            }
            
            // Extract textures property
            const texturesProperty = profile.properties?.find(p => p.name === 'textures');
            if (!texturesProperty) {
                console.warn(`No textures property found for UUID ${uuid}`);
                return this._cacheAndReturn(uuid, this.DEFAULT_SKIN);
            }
            
            // Decode base64 textures value
            const texturesJson = Buffer.from(texturesProperty.value, 'base64').toString('utf-8');
            const textures = JSON.parse(texturesJson);
            
            // Extract skin URL and model
            const skinData = textures.textures?.SKIN;
            if (!skinData || !skinData.url) {
                console.warn(`No skin URL found for UUID ${uuid}`);
                return this._cacheAndReturn(uuid, this.DEFAULT_SKIN);
            }
            
            const skinUrl = skinData.url;
            const model = skinData.metadata?.model || 'default'; // 'default' = Steve, 'slim' = Alex
            
            console.log(`✅ Resolved skin for ${uuid}: ${model} model`);
            
            return this._cacheAndReturn(uuid, { skinUrl, model });
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error(`Timeout fetching skin for UUID ${uuid}`);
            } else {
                console.error(`Error fetching skin for UUID ${uuid}:`, error.message);
            }
            return this._cacheAndReturn(uuid, this.DEFAULT_SKIN);
        }
    }

    /**
     * Cache skin data and return it
     * @private
     */
    _cacheAndReturn(uuid, skinData) {
        this.cache.set(uuid, {
            ...skinData,
            timestamp: Date.now()
        });
        return skinData;
    }

    /**
     * Clear expired cache entries
     */
    cleanCache() {
        const now = Date.now();
        for (const [uuid, data] of this.cache.entries()) {
            if (now - data.timestamp > this.CACHE_DURATION_MS) {
                this.cache.delete(uuid);
            }
        }
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            size: this.cache.size,
            pending: this.pendingFetches.size
        };
    }
}

// Export singleton instance
module.exports = new SkinService();
