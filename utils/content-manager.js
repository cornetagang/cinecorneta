// ===========================================================
// MÓDULO CENTRALIZADO DE GESTIÓN DE CONTENIDO
// ===========================================================

export const ContentManager = {
    
    /**
     * Busca contenido por ID en todas las fuentes disponibles
     * @param {string} id - ID del contenido a buscar
     * @param {Object} appState - Estado global de la aplicación
     * @returns {Object|null} - Datos del contenido o null si no se encuentra
     */
    findById(id, appState) {
        if (!id || !appState) return null;

        const content = appState.content;

        // 1. Buscar en películas
        if (content.movies && content.movies[id]) {
            return { ...content.movies[id], type: 'movie', source: 'movies' };
        }

        // 2. Buscar en series
        if (content.series && content.series[id]) {
            return { ...content.series[id], type: 'series', source: 'series' };
        }

        // 3. Buscar en UCM (legacy - puede eliminarse si ya no se usa)
        if (content.ucm && content.ucm[id]) {
            return { ...content.ucm[id], type: 'movie', source: 'ucm' };
        }

        // 4. Buscar en sagas dinámicas
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

        return null;
    },

    /**
     * Obtiene solo el tipo de contenido
     * @param {string} id - ID del contenido
     * @param {Object} appState - Estado global
     * @returns {string|null} - 'movie', 'series', o null
     */
    getType(id, appState) {
        const item = this.findById(id, appState);
        return item ? item.type : null;
    },

    /**
     * Obtiene la fuente de donde proviene el contenido
     * @param {string} id - ID del contenido
     * @param {Object} appState - Estado global
     * @returns {string|null} - Nombre de la fuente o null
     */
    getSource(id, appState) {
        const item = this.findById(id, appState);
        return item ? item.source : null;
    },

    /**
     * Busca contenido por título (útil para búsquedas)
     * @param {string} query - Texto de búsqueda
     * @param {Object} appState - Estado global
     * @param {Object} options - Opciones de búsqueda
     * @returns {Array} - Array de resultados
     */
    searchByTitle(query, appState, options = {}) {
        const {
            limit = 20,
            sources = ['movies', 'series', 'sagas'],
            caseSensitive = false
        } = options;

        const results = [];
        const searchQuery = caseSensitive ? query : query.toLowerCase();
        const content = appState.content;

        // Función helper para verificar coincidencia
        const matches = (title) => {
            const titleToCheck = caseSensitive ? title : title.toLowerCase();
            return titleToCheck.includes(searchQuery);
        };

        // Buscar en películas
        if (sources.includes('movies') && content.movies) {
            for (const [id, data] of Object.entries(content.movies)) {
                if (matches(data.title || '')) {
                    results.push({ id, ...data, type: 'movie', source: 'movies' });
                    if (results.length >= limit) return results;
                }
            }
        }

        // Buscar en series
        if (sources.includes('series') && content.series) {
            for (const [id, data] of Object.entries(content.series)) {
                if (matches(data.title || '')) {
                    results.push({ id, ...data, type: 'series', source: 'series' });
                    if (results.length >= limit) return results;
                }
            }
        }

        // Buscar en sagas
        if (sources.includes('sagas') && content.sagas) {
            for (const sagaKey in content.sagas) {
                const sagaData = content.sagas[sagaKey];
                if (!sagaData) continue;
                for (const [id, data] of Object.entries(sagaData)) {
                    if (matches(data.title || '')) {
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
     * Obtiene todos los IDs de un tipo específico
     * @param {string} type - 'movie' o 'series'
     * @param {Object} appState - Estado global
     * @returns {Array} - Array de IDs
     */
    getAllIds(type, appState) {
        const content = appState.content;
        const ids = [];

        if (type === 'movie' && content.movies) {
            ids.push(...Object.keys(content.movies));
        }

        if (type === 'series' && content.series) {
            ids.push(...Object.keys(content.series));
        }

        // Incluir sagas
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

        return [...new Set(ids)]; // Eliminar duplicados
    },

    /**
     * Verifica si un ID existe en el contenido
     * @param {string} id - ID a verificar
     * @param {Object} appState - Estado global
     * @returns {boolean}
     */
    exists(id, appState) {
        return this.findById(id, appState) !== null;
    },

    /**
     * Obtiene metadatos (ratings, etc.) de un contenido
     * @param {string} id - ID del contenido
     * @param {Object} appState - Estado global
     * @returns {Object|null} - Metadata o null
     */
    getMetadata(id, appState) {
        const content = this.findById(id, appState);
        if (!content) return null;

        const type = content.type;
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
     * Obtiene información de episodios para una serie
     * @param {string} seriesId - ID de la serie
     * @param {Object} appState - Estado global
     * @returns {Object|null} - Datos de episodios o null
     */
    getSeriesEpisodes(seriesId, appState) {
        return appState.content.seriesEpisodes?.[seriesId] || null;
    },

    /**
     * Obtiene posters de temporadas
     * @param {string} seriesId - ID de la serie
     * @param {Object} appState - Estado global
     * @returns {Object|null} - Posters de temporadas o null
     */
    getSeasonPosters(seriesId, appState) {
        return appState.content.seasonPosters?.[seriesId] || null;
    }
};

export default ContentManager;
