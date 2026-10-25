/* Name suggestions only: this never authenticates a user or changes their email. */
(() => {
  const clean = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  function suggest(email, users) {
    const parts = String(email || '').trim().toLowerCase().split('@');
    if (parts.length !== 2 || !parts[0]) return null;
    const local = parts[0].split('+')[0].replace(/\d+$/, '');
    const tokens = local.split(/[._-]+/).filter(Boolean).map(clean);
    const joined = clean(local);
    if (!joined || !tokens.length) return null;
    const ranked = users.map(user => {
      const firsts = [...new Set([user.first_name, user.name.split(/\s+/)[0]].map(clean).filter(Boolean))];
      const last = clean(user.last_name || '');
      let score = 0;
      for (const first of firsts) {
        if (first.length > 1 && joined === first) score = Math.max(score, 90);
        if (last && [first + last, last + first].includes(joined)) score = Math.max(score, 100);
        if (last && [first[0] + last, last + first[0]].includes(joined)) score = Math.max(score, 98);
        if (!last && first.length > 1 && tokens.length > 1 && tokens[0] === first) score = Math.max(score, 85);
      }
      return { user, score };
    }).filter(item => item.score >= 85).sort((a, b) => b.score - a.score);
    if (!ranked.length || (ranked[1] && ranked[0].score - ranked[1].score < 10)) return null;
    return ranked[0].user;
  }
  globalThis.familyProfileMatch = { suggest };
})();
