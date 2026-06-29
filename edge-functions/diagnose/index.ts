// Diagnóstico ECOM com IA — Supabase Edge Function (Deno)
// Recebe { url, answers } da LP, busca a página, e usa o Claude para gerar
// notas reais dos 8 pilares + diagnóstico. Sempre devolve JSON válido
// (fallback determinístico se a IA/fetch falhar) pro funil nunca quebrar.
// Chave da Anthropic vem do secret do Supabase: ANTHROPIC_API_KEY.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PILLARS = [
  { key: "ticket_medio", label: "Ticket Médio" },
  { key: "experiencia", label: "Experiência do Usuário" },
  { key: "checkout", label: "Checkout" },
  { key: "mix_produtos", label: "Mix de Produtos" },
  { key: "competitividade", label: "Competitividade" },
  { key: "ofertas", label: "Ofertas e Incentivos" },
  { key: "confianca", label: "Confiança" },
  { key: "conversao", label: "Taxa de Conversão" },
];

const FAT_MID: Record<string, number> = {
  "menos-10k": 7000, "10-25k": 17500, "25-50k": 37500,
  "50-100k": 75000, "100-300k": 200000, "mais-300k": 420000,
};

function normalizeUrl(raw: string) {
  if (!raw) return null;
  let u = String(raw).trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try { return new URL(u).toString(); } catch { return null; }
}

function htmlToText(html: string) {
  if (!html) return "";
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/?[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchStore(url: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal, redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PlusMidiaDiagnostico/1.0)" },
    });
    const html = await r.text();
    return htmlToText(html).slice(0, 7000);
  } catch { return ""; } finally { clearTimeout(t); }
}

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function moneyOnTable(answers: any, pillars: any[]) {
  const fat = FAT_MID[answers?.faturamento] || 17500;
  const byKey: Record<string, number> = Object.fromEntries(pillars.map((p) => [p.key, p.score]));
  const avg = pillars.reduce((s, p) => s + p.score, 0) / pillars.length;
  const conv = byKey.conversao ?? avg;
  const ticket = byKey.ticket_medio ?? avg;
  const checkout = byKey.checkout ?? avg;
  const weighted = (avg + conv + ticket + checkout) / 4;
  const gap = Math.min(1, Math.max(0, (10 - weighted) / 10));
  let rate = 0.10 + gap * 0.34;
  rate = Math.min(0.42, Math.max(0.09, rate));
  return Math.round(fat * rate * 100) / 100;
}

function fallbackDiagnostic(answers: any) {
  const seedStr = JSON.stringify(answers || {});
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const baseByFat: Record<string, number> = {
    "menos-10k": 3.6, "10-25k": 4.3, "25-50k": 5.0, "50-100k": 5.6, "100-300k": 6.2, "mais-300k": 6.8,
  };
  const base = baseByFat[answers?.faturamento] ?? 4.5;
  const templates: Record<string, string> = {
    ticket_medio: "Seu ticket médio está abaixo do ideal, indicando que você está deixando dinheiro na mesa em cada venda.",
    experiencia: "A experiência tem pontos críticos que geram atrito, especialmente quando o cliente acessa pelo celular.",
    checkout: "Seu processo de checkout é funcional, mas ainda pode ser otimizado para reduzir perdas na finalização.",
    mix_produtos: "Seu mix de produtos é bem distribuído e pensado para gerar volume, margem e recorrência.",
    competitividade: "Você está competitivo em alguns pontos, mas ainda perde espaço em diferenciais importantes.",
    ofertas: "Você já utiliza algumas estratégias de oferta, mas pode aumentar o impacto delas na conversão.",
    confianca: "Existem alguns elementos de confiança, mas ainda faltam provas mais fortes para convencer o cliente.",
    conversao: "Sua taxa de conversão está abaixo do esperado, indicando perdas relevantes ao longo da jornada de compra.",
  };
  const bias: Record<string, number> = { conversao: -1.8, ticket_medio: -1.4, experiencia: -1.3, checkout: -0.6, confianca: -0.9, ofertas: -0.4, competitividade: 0.4, mix_produtos: 1.2 };
  const pillars = PILLARS.map((p) => {
    let s = Math.round(base + (bias[p.key] || 0) + (rnd() * 2 - 1));
    s = Math.min(8, Math.max(3, s));
    return { key: p.key, score: s, comment: templates[p.key] };
  });
  const avg = pillars.reduce((a, p) => a + p.score, 0) / pillars.length;
  const maturity = Math.round(Math.min(78, Math.max(22, avg * 9)));
  return {
    maturity,
    summary: "Sua análise inicial mostrou que existe espaço claro para crescimento na sua marca, com oportunidades concretas de recuperar receita.",
    pillars,
  };
}

function buildPrompt(answers: any, storeText: string, url: string | null) {
  const labelMap: Record<string, Record<string, string>> = {
    segmento: { "moda-praia": "Moda Praia", "moda-masculina": "Moda Masculina", "moda-feminina": "Moda Feminina", "moda-fitness": "Moda Fitness", "moda-infantil": "Moda Infantil", "moda-intima": "Moda Íntima", "outros": "Outros" },
    volume: { "sem-site": "Sem site próprio", "menos-30": "Menos de 30 vendas/mês", "30-100": "30 a 100 vendas/mês", "100-300": "100 a 300 vendas/mês", "300-1000": "300 a 1000 vendas/mês", "mais-1000": "Mais de 1000 vendas/mês" },
    trafego: { "nao": "Não investe em tráfego", "100-3k": "R$100 a R$3.000/mês", "3k-10k": "R$3.000 a R$10.000/mês", "10k-20k": "R$10.000 a R$20.000/mês", "20k-50k": "R$20.000 a R$50.000/mês", "mais-50k": "Mais de R$50.000/mês" },
    faturamento: { "menos-10k": "Menos de R$10.000/mês", "10-25k": "R$10.000 a R$25.000/mês", "25-50k": "R$25.000 a R$50.000/mês", "50-100k": "R$50.000 a R$100.000/mês", "100-300k": "R$100.000 a R$300.000/mês", "mais-300k": "Mais de R$300.000/mês" },
  };
  const a = answers || {};
  return `Você é um estrategista sênior de e-commerce da Plus Mídia, fazendo um diagnóstico express de uma loja online.

DADOS INFORMADOS PELO LOJISTA:
- Segmento: ${labelMap.segmento[a.segmento] || a.segmento || "não informado"}
- Volume de vendas: ${labelMap.volume[a.volume] || a.volume || "não informado"}
- Investimento em tráfego: ${labelMap.trafego[a.trafego] || a.trafego || "não informado"}
- Faturamento mensal: ${labelMap.faturamento[a.faturamento] || a.faturamento || "não informado"}
- URL da loja: ${url || "não informada"}

CONTEÚDO EXTRAÍDO DA LOJA (texto bruto, pode estar incompleto):
"""
${storeText || "(não foi possível extrair o conteúdo da loja — baseie-se nas respostas do quiz e no segmento)"}
"""

TAREFA:
Avalie a loja em 8 pilares e dê uma nota inteira de 1 a 10 para cada, com um comentário curto (1-2 frases, PT-BR, tom consultivo e direto). Os pilares (use exatamente estas keys):
- ticket_medio (Ticket Médio)
- experiencia (Experiência do Usuário)
- checkout (Checkout)
- mix_produtos (Mix de Produtos)
- competitividade (Competitividade)
- ofertas (Ofertas e Incentivos)
- confianca (Confiança)
- conversao (Taxa de Conversão)

DIRETRIZES IMPORTANTES:
- O objetivo do diagnóstico é evidenciar que a loja está DEIXANDO DINHEIRO NA MESA e gerar interesse numa conversa com a Plus Mídia. As notas devem ser realistas e ancoradas no que foi observado, mas o enquadramento deve sempre apontar oportunidade não capturada.
- Garanta que pelo menos 3 pilares tenham nota <= 5 (oportunidades claras). Evite dar muitas notas 9 ou 10 — quase nada é perfeito.
- Os comentários devem soar específicos para o segmento e o porte da loja, não genéricos.
- "maturity" é um inteiro de 0 a 100 representando o nível de maturidade do e-commerce frente às práticas de mercado (0=iniciante, 100=avançado). Mantenha entre 25 e 75 na maioria dos casos.
- "summary" é 1 frase de fechamento dizendo que há espaço de crescimento e receita a recuperar.

Responda APENAS com um JSON válido neste formato, sem texto fora do JSON, sem cercas de código:
{"maturity": <int 0-100>, "summary": "<frase>", "pillars": [{"key":"ticket_medio","score":<1-10>,"comment":"<texto>"}, ... (os 8 pilares)]}`;
}

function stripFences(t: string) {
  return String(t || "").replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
}

function jsonResp(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResp({ error: "method_not_allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const answers = body?.answers || {};
  const url = normalizeUrl(body?.url);

  let diagnostic: any;
  let source = "ai";

  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) throw new Error("no_key");
    const storeText = url ? await fetchStore(url) : "";
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 2000,
        messages: [{ role: "user", content: buildPrompt(answers, storeText, url) }],
      }),
    });
    if (!r.ok) throw new Error("api_" + r.status);
    const data = await r.json();
    const txt = (data.content || []).find((b: any) => b.type === "text")?.text || "";
    diagnostic = JSON.parse(stripFences(txt));
    const byKey: Record<string, any> = Object.fromEntries((diagnostic.pillars || []).map((p: any) => [p.key, p]));
    diagnostic.pillars = PILLARS.map((p) => byKey[p.key] || { key: p.key, score: 5, comment: "" });
  } catch (_e) {
    diagnostic = fallbackDiagnostic(answers);
    source = "fallback";
  }

  const labelByKey: Record<string, string> = Object.fromEntries(PILLARS.map((p) => [p.key, p.label]));
  diagnostic.pillars = diagnostic.pillars.map((p: any) => ({
    ...p, label: labelByKey[p.key] || p.key,
    score: Math.min(10, Math.max(1, Math.round(p.score))),
  }));
  const money = moneyOnTable(answers, diagnostic.pillars);

  return jsonResp({
    source, money, money_formatted: brl(money),
    maturity: Math.min(100, Math.max(0, Math.round(diagnostic.maturity ?? 50))),
    summary: diagnostic.summary || "",
    pillars: diagnostic.pillars,
  });
});
