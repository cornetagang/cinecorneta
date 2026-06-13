// ===========================================================
// MÓDULO CENTRALIZADO DE GESTIÓN DE CONTENIDO (utils/content-manager.js)
// ===========================================================

export const ContentManager = {
    
    /**
     * Busca contenido por ID en todas las fuentes disponibles del estado global.
     * @param {string} id - ID del contenido a buscar
     * @param {Object} appState - Estado global de la aplicación (shared.appState)
     * @returns {Object|null} - Datos del contenido o null si no se encuentra
     */
    findById(id, appState) {
        if (!id || !appState || !appState.content) return null;

        const content = appState.content;

        // 1. Buscar en películas principales
        if (content.movies && content.movies[id]) {
            return { ...content.movies[id], type: 'movie', source: 'movies' };
        }

        // 2. Buscar en series
        if (content.series && content.series[id]) {
            return { ...content.series[id], type: 'series', source: 'series' };
        }

        // 3. Buscar en UCM (Legacy - retrocompatibilidad)
        if (content.ucm && content.ucm[id]) {
            return { ...content.ucm[id], type: 'movie', source: 'ucm' };
        }

        // 4. Buscar en sagas dinámicas (Star Wars, Harry Potter, etc.)
        if (content.sagas) {
            for (const sagaKey in content.sagas) {
                const sagaData = content.sagas[sagaKey];
                if (sagaData && sagaData[id]) {
                    return { 
                        ...sagaData[id], 
                        type: sagaData[id].type || 'movie',
                        source: sagaKey 
                    };
                }
            }
        }

        return null; // No se encontró en ninguna parte
    },

    /**
     * Obtiene solo el tipo de contenido ('movie' o 'series')
     * @param {string} id - ID del contenido
     * @param {Object} appState - Estado global
     * @returns {string|null}
     */
    getType(id, appState) {
        const item = this.findById(id, appState);
        return item ? item.type : null;
    },

    /**
     * Obtiene la fuente o categoría de donde proviene el contenido
     * @param {string} id - ID del contenido
     * @param {Object} appState - Estado global
     * @returns {string|null} - Nombre de la fuente (ej: 'movies', 'series', 'starwars')
     */
    getSource(id, appState) {
        const item = this.findById(id, appState);
        return item ? item.source : null;
    },

    /**
     * Busca contenido por título (útil para la barra de búsqueda principal)
     * @param {string} query - Texto de búsqueda
     * @param {Object} appState - Estado global
     * @param {Object} options - Opciones (limit, sources, caseSensitive)
     * @returns {Array} - Array de resultados encontrados
     */
    searchByTitle(query, appState, options = {}) {
        if (!appState || !appState.content) return [];

        const {
            limit = 20,
            sources = ['movies', 'series', 'sagas'],
            caseSensitive = false
        } = options;

        const results = [];
        const searchQuery = caseSensitive ? query : query.toLowerCase();
        const content = appState.content;

        // Helper interno para verificar coincidencias
        const matches = (title) => {
            if (!title) return false;
            const titleToCheck = caseSensitive ? title : title.toLowerCase();
            return titleToCheck.includes(searchQuery);
        };

        // Búsqueda en Películas
        if (sources.includes('movies') && content.movies) {
            for (const [id, data] of Object.entries(content.movies)) {
                if (matches(data.title)) {
                    results.push({ id, ...data, type: 'movie', source: 'movies' });
                    if (results.length >= limit) return results;
                }
            }
        }

        // Búsqueda en Series
        if (sources.includes('series') && content.series) {
            for (const [id, data] of Object.entries(content.series)) {
                if (matches(data.title)) {
                    results.push({ id, ...data, type: 'series', source: 'series' });
                    if (results.length >= limit) return results;
                }
            }
        }

        // Búsqueda en Sagas
        if (sources.includes('sagas') && content.sagas) {
            for (const sagaKey in content.sagas) {
                const sagaData = content.sagas[sagaKey];
                if (!sagaData) continue;
                
                for (const [id, data] of Object.entries(sagaData)) {
                    if (matches(data.title)) {
                        results.push({ 
                            id, 
                            ...data, 
                            type: data.type || 'movie',
                            source: sagaKey 
                        });
                        if (results.length >= limit) return results;
                    }
                }
            }
        }

        return results;
    },

    /**
     * Obtiene un listado con todos los IDs de un tipo específico
     * @param {string} type - 'movie' o 'series'
     * @param {Object} appState - Estado global
     * @returns {Array} - Array de strings con los IDs
     */
    getAllIds(type, appState) {
        if (!appState || !appState.content) return [];
        
        const content = appState.content;
        const ids = [];

        if (type === 'movie' && content.movies) {
            ids.push(...Object.keys(content.movies));
        }

        if (type === 'series' && content.series) {
            ids.push(...Object.keys(content.series));
        }

        // Filtrar sagas por tipo
        if (content.sagas) {
            for (const sagaKey in content.sagas) {
                const sagaData = content.sagas[sagaKey];
                if (!sagaData) continue;
                for (const [id, data] of Object.entries(sagaData)) {
                    if ((data.type || 'movie') === type) {
                        ids.push(id);
                    }
                }
            }
        }

        return [...new Set(ids)]; // Retornamos IDs únicos
    },

    /**
     * Verifica rápidamente si un ID existe en el catálogo
     * @param {string} id - ID a verificar
     * @param {Object} appState - Estado global
     * @returns {boolean}
     */
    exists(id, appState) {
        return this.findById(id, appState) !== null;
    },

    /**
     * Obtiene los metadatos extendidos (ratings, duraciones, etc.)
     * @param {string} id - ID del contenido
     * @param {Object} appState - Estado global
     * @returns {Object|null}
     */
    getMetadata(id, appState) {
        const contentItem = this.findById(id, appState);
        if (!contentItem || !appState.content.metadata) return null;

        const type = contentItem.type;
        const metadata = appState.content.metadata;

        if (type === 'movie' && metadata.movies) {
            return metadata.movies[id] || null;
        }

        if (type === 'series' && metadata.series) {
            return metadata.series[id] || null;
        }

        return null;
    },

    /**
     * Obtiene el objeto completo de episodios de una serie
     * @param {string} seriesId - ID de la serie
     * @param {Object} appState - Estado global
     * @returns {Object|null}
     */
    getSeriesEpisodes(seriesId, appState) {
        return appState?.content?.seriesEpisodes?.[seriesId] || null;
    },

    /**
     * Obtiene la información de los posters de cada temporada de una serie
     * @param {string} seriesId - ID de la serie
     * @param {Object} appState - Estado global
     * @returns {Object|null}
     */
    getSeasonPosters(seriesId, appState) {
        return appState?.content?.seasonPosters?.[seriesId] || null;
    },

    // ===========================================================
    // 🆕 SUBTÍTULOS — Mapeo de columnas de Google Sheet
    // Columna E → subId  |  Columna F → subType ('srt' | 'ass')
    // ===========================================================

    /**
     * Extrae y normaliza la configuración de subtítulos de un episodio o película.
     * Lee los campos subId (col E) y subType (col F) que devuelve el Apps Script.
     *
     * Reglas:
     *  - Si subType es 'srt' → player usará art.subtitle.url (nativo, liviano, ideal móvil)
     *  - Si subType es 'ass' → player usará SubtitlesOctopus WASM (renderizado avanzado)
     *  - Si hay subId pero no subType → fallback a 'srt' (más seguro en móvil)
     *  - Si no hay subId → { subId: null, subType: null } (no intentar cargar nada)
     *
     * @param {Object} item - Objeto de episodio o película
     * @returns {{ subId: string|null, subType: 'srt'|'ass'|null }}
     */
    getSubtitleConfig(item) {
        if (!item) return { subId: null, subType: null };

        // Soportar variantes de nombre de campo por compatibilidad
        const rawSubId = (
            item.subId   ||
            item.sub_id  ||
            item.subtitleId ||
            ''
        ).toString().trim();

        const rawSubType = (
            item.subType      ||
            item.sub_type     ||
            item.subtitleType ||
            ''
        ).toString().trim().toLowerCase();

        const subId = rawSubId || null;

        // Solo aceptar valores válidos explícitos
        let subType = null;
        if (subId) {
            if (rawSubType === 'ass' || rawSubType === 'ssa') {
                subType = 'ass';
            } else {
                // 'srt', vacío, o cualquier otro valor → SRT (más liviano y compatible)
                subType = 'srt';
            }
        }

        return { subId, subType };
    },

    /**
     * Aplica getSubtitleConfig a todos los episodios de una temporada.
     * Útil para pre-validar antes de renderizar la lista de episodios.
     *
     * @param {Array} episodes - Array de objetos episodio
     * @returns {Array} - Array con { subId, subType } normalizado en cada episodio
     */
    normalizeEpisodeSubtitles(episodes) {
        if (!Array.isArray(episodes)) return [];
        return episodes.map(ep => ({
            ...ep,
            ...this.getSubtitleConfig(ep)  // Sobrescribe subId/subType con versión normalizada
        }));
    },

    /**
     * Verifica si un episodio o película tiene subtítulos válidos configurados.
     *
     * @param {Object} item - Objeto de episodio o película
     * @returns {boolean}
     */
    hasSubtitles(item) {
        const { subId } = this.getSubtitleConfig(item);
        return subId !== null;
    },
};

export default ContentManager;
