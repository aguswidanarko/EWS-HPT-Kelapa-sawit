import { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { masterApi, usersApi } from '../api/resources';

const MasterDataContext = createContext(null);

export function MasterDataProvider({ children }) {
  const [estates, setEstates] = useState([]);
  const [afdelings, setAfdelings] = useState([]);
  const [bloks, setBloks] = useState([]);
  const [hpt, setHpt] = useState([]);
  const [species, setSpecies] = useState([]);
  const [users, setUsers] = useState([]);
  const [ewsCategories, setEwsCategories] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    return Promise.all([
      masterApi.estates.list().catch(() => []),
      masterApi.afdelings.list().catch(() => []),
      masterApi.bloks.list().catch(() => []),
      masterApi.hpt.list().catch(() => []),
      masterApi.species.list().catch(() => []),
      usersApi.list().catch(() => []),
      masterApi.ewsCategories.list().catch(() => []),
    ]).then(([e, a, b, h, s, u, c]) => {
      setEstates(e || []);
      setAfdelings(a || []);
      setBloks(b || []);
      setHpt(h || []);
      setSpecies(s || []);
      setUsers(u || []);
      setEwsCategories(c || []);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const maps = useMemo(() => {
    const byId = (arr) => Object.fromEntries((arr || []).map((x) => [String(x.id), x]));
    return {
      estateById: byId(estates),
      afdelingById: byId(afdelings),
      blokById: byId(bloks),
      hptById: byId(hpt),
      speciesById: byId(species),
      userById: byId(users),
      ewsCategoryById: byId(ewsCategories),
    };
  }, [estates, afdelings, bloks, hpt, species, users, ewsCategories]);

  const value = useMemo(() => ({
    estates, afdelings, bloks, hpt, species, users, ewsCategories, loaded, reload, ...maps,
    estateName: (id) => maps.estateById[String(id)]?.name || (id ? `#${id}` : '-'),
    afdelingName: (id) => maps.afdelingById[String(id)]?.name || (id ? `#${id}` : '-'),
    blokName: (id) => maps.blokById[String(id)]?.code || (id ? `#${id}` : '-'),
    hptName: (id) => maps.hptById[String(id)]?.name || (id ? `#${id}` : '-'),
    speciesName: (id) => maps.speciesById[String(id)]?.name || (id ? `#${id}` : '-'),
    userName: (id) => maps.userById[String(id)]?.name || (id ? `#${id}` : '-'),
    ewsCategoryName: (id) => maps.ewsCategoryById[String(id)]?.name || (id ? `#${id}` : '-'),
    bloksByAfdeling: (afdelingId) => bloks.filter((b) => String(b.afdeling_id) === String(afdelingId)),
    afdelingsByEstate: (estateId) => afdelings.filter((a) => String(a.estate_id) === String(estateId)),
    // Indicator table (hpt) narrowed by V2 indicator_type -- see SPEC_V2.md section 2.
    hptByIndicatorType: (type) => hpt.filter((h) => (h.indicator_type || 'HPT') === type),
  }), [estates, afdelings, bloks, hpt, species, users, ewsCategories, loaded, reload, maps]);

  return <MasterDataContext.Provider value={value}>{children}</MasterDataContext.Provider>;
}

export function useMasterData() {
  const ctx = useContext(MasterDataContext);
  if (!ctx) throw new Error('useMasterData must be used within MasterDataProvider');
  return ctx;
}
