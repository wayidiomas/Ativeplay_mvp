// Debug script - Cole no console do browser
// Verifica quantos grupos existem no IndexedDB

async function debugGroups() {
  const dbName = 'AtivePlayDB';
  const request = indexedDB.open(dbName);

  return new Promise((resolve, reject) => {
    request.onsuccess = async (event) => {
      const db = event.target.result;
      const transaction = db.transaction(['groups', 'items', 'playlists'], 'readonly');

      const groupsStore = transaction.objectStore('groups');
      const itemsStore = transaction.objectStore('items');
      const playlistsStore = transaction.objectStore('playlists');

      const allGroups = await new Promise((res) => {
        const req = groupsStore.getAll();
        req.onsuccess = () => res(req.result);
      });

      const allItems = await new Promise((res) => {
        const req = itemsStore.getAll();
        req.onsuccess = () => res(req.result);
      });

      const allPlaylists = await new Promise((res) => {
        const req = playlistsStore.getAll();
        req.onsuccess = () => res(req.result);
      });

      console.log('===== DEBUG GRUPOS =====');
      console.log('Total de grupos no DB:', allGroups.length);
      console.log('Total de items no DB:', allItems.length);
      console.log('Total de playlists no DB:', allPlaylists.length);

      // Agrupa por mediaKind
      const byMediaKind = {};
      allGroups.forEach(group => {
        byMediaKind[group.mediaKind] = (byMediaKind[group.mediaKind] || 0) + 1;
      });

      console.log('\nGrupos por mediaKind:');
      console.log('  Movies:', byMediaKind.movie || 0);
      console.log('  Series:', byMediaKind.series || 0);
      console.log('  Live:', byMediaKind.live || 0);

      // Mostra alguns grupos de exemplo
      console.log('\nPrimeiros 10 grupos (movies):');
      allGroups
        .filter(g => g.mediaKind === 'movie')
        .slice(0, 10)
        .forEach((g, i) => {
          console.log(`  ${i+1}. ${g.name} (${g.itemCount} items)`);
        });

      console.log('\nTamanho estimado do IndexedDB:');
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        const usageMB = (estimate.usage / 1024 / 1024).toFixed(2);
        const quotaMB = (estimate.quota / 1024 / 1024).toFixed(2);
        console.log(`  Uso: ${usageMB} MB`);
        console.log(`  Quota: ${quotaMB} MB`);
        console.log(`  Percentual: ${((estimate.usage / estimate.quota) * 100).toFixed(2)}%`);
      }

      resolve({ allGroups, allItems, allPlaylists });
    };

    request.onerror = () => reject(request.error);
  });
}

// Execute
debugGroups();
