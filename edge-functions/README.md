# Edge Functions (Supabase) — usadas pela LP do Diagnóstico ECOM

Estas funções rodam no **Supabase do GPM** (projeto `rkngilknpcibcwalropj`), não na Vercel.
Esta pasta é só um **backup versionado** do código-fonte (a fonte "viva" fica no repo `gpm-nexus/supabase/functions/`).

## `diagnose/`
IA real do diagnóstico (Claude). A LP chama:
`POST https://rkngilknpcibcwalropj.supabase.co/functions/v1/diagnose`  body `{ url, answers }`.

- Lê o HTML do site, monta o prompt e chama `claude-opus-4-8` (`api.anthropic.com/v1/messages`).
- Chave fica como **secret do Supabase**: `ANTHROPIC_API_KEY` (NÃO vai pro git/Vercel).
- Pública (`--no-verify-jwt`), CORS `*`. Fallback determinístico se a IA/fetch falhar.

### Deploy / atualizar
```bash
cd ~/Desktop/GPM/gpm-nexus
export SUPABASE_ACCESS_TOKEN=<personal access token sbp_...>   # criar em supabase.com/dashboard/account/tokens
supabase secrets set ANTHROPIC_API_KEY='<sk-ant-...>' --project-ref rkngilknpcibcwalropj
supabase functions deploy diagnose --no-verify-jwt --project-ref rkngilknpcibcwalropj
```

## Métricas do funil
A tabela/RPC ficam em `../diagnosticoai/metrics/SETUP.sql` (rodar 1x no SQL Editor).
Tracker: `../diagnosticoai/track.js`. Dashboard: `../diagnosticoai/metrics/`.
