import { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { masterApi, usersApi } from '../api/resources';

const MasterDataContext = createContext(null);

export function MasterDataProvider({ children }) {
  const [regions, setRegions] = useState([]);
  const [businessUnits, setBusinessUnits] = useState([]);
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
      masterApi.regions.list().catch(() => []),
      masterApi.businessUnits.list().catch(() => []),
      masterApi.estates.list().catch(() => []),
      masterApi.afdelings.list().catch(() => []),
      masterApi.bloks.list().catch(() => []),
      masterApi.hpt.list().catch(() => []),
      masterApi.species.list().catch(() => []),
      usersApi.list().catch(() => []),
      masterApi.ewsCategories.list().catch(() => []),
    ]).then(([r, bu, e, a, b, h, s, u, c]) => {
      setRegions(r || []);
      setBusinessUnits(bu || []);
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
      regionById: byId(regions),
      businessUnitById: byId(businessUnits),
      estateById: byId(estates),
      afdelingById: byId(afdelings),
      blokById: byId(bloks),
      hptById: byId(hpt),
      speciesById: byId(species),
      userById: byId(users),
      ewsCategoryById: byId(ewsCategories),
    };
  }, [regions, businessUnits, estates, afdelings, bloks, hpt, species, users, ewsCategories]);

  const value = useMemo(() => ({
    regions, businessUnits, estates, afdelings, bloks, hpt, species, users, ewsCategories, loaded, reload, ...maps,
    regionName: (id) => maps.regionById[String(id)]?.name || (id ? `#${id}` : '-'),
    businessUnitName: (id) => maps.businessUnitById[String(id)]?.name || (id ? `#${id}` : '-'),
    estateName: (id) => maps.estateById[String(id)]?.name || (id ? `#${id}` : '-'),
    afdelingName: (id) => maps.afdelingById[String(id)]?.name || (id ? `#${id}` : '-'),
    blokName: (id) => maps.blokById[String(id)]?.code || (id ? `#${id}` : '-'),
    hptName: (id) => maps.hptById[String(id)]?.name || (id ? `#${id}` : '-'),
    speciesName: (id) => maps.speciesById[String(id)]?.name || (id ? `#${id}` : '-'),
    userName: (id) => maps.userById[String(id)]?.name || (id ? `#${id}` : '-'),
    ewsCategoryName: (id) => maps.ewsCategoryById[String(id)]?.name || (id ? `#${id}` : '-'),
    bloksByAfdeling: (afdelingId) => bloks.filter((b) => String(b.afdeling_id) === String(afdelingId)),
    afdelingsByEstate: (estateId) => afdelings.filter((a) => String(a.estate_id) === String(estateId)),
    // V3.2 hierarchy helpers: Region -> Bisnis Unit -> PT (estate).
    businessUnitsByRegion: (regionId) => businessUnits.filter((b) => String(b.region_id) === String(regionId)),
    estatesByBusinessUnit: (businessUnitId) => estates.filter((e) => String(e.bisnis_unit_id) === String(businessUnitId)),
    // Indicator table (hpt) narrowed by V2 indicator_type -- see SPEC_V2.md section 2.
    hptByIndicatorType: (type) => hpt.filter((h) => (h.indicator_type || 'HPT') === type),
  }), [regions, businessUnits, estates, afdelings, bloks, hpt, species, users, ewsCategories, loaded, reload, maps]);

  return <MasterDataContext.Provider value={value}>{children}</MasterDataContext.Provider>;
}

export function useMasterData() {
  const ctx = useContext(MasterDataContext);
  if (!ctx) throw new Error('useMasterData must be used within MasterDataProvider');
  return ctx;
}
