export const STAIR_CATALOG_REFERENCES = [
  {
    id: "baroque-led-gold-front",
    fileName: "instagram/baroque-led-gold-front.jpg",
    downloadFileName: "ALTYN-SAPA-baroque-led-gold-front.jpg",
    contentType: "image/jpeg",
    publicUrl: "/catalog/stairs/instagram/baroque-led-gold-front.jpg",
    title: "Барокко · белая лестница с золотом",
    material: "Дерево · золотые балясины · подсветка",
    note: "Реальный проект ALTYN SAPA · общий вид",
    sourceUrl: "https://www.instagram.com/altyn_sapa.company/p/DbmA_dpDckZ/",
    isReal: true,
    category: "stairs",
    tags: ["Латунь", "Классика", "Подсветка"],
  },
  {
    id: "baroque-led-gold-full",
    fileName: "instagram/baroque-led-gold-full.jpg",
    downloadFileName: "ALTYN-SAPA-baroque-led-gold-full.jpg",
    contentType: "image/jpeg",
    publicUrl: "/catalog/stairs/instagram/baroque-led-gold-full.jpg",
    title: "Барокко · вид на два марша",
    material: "Дерево · резные элементы · подсветка",
    note: "Реальный проект ALTYN SAPA · полный ракурс",
    sourceUrl: "https://www.instagram.com/altyn_sapa.company/p/DbmA_dpDckZ/",
    isReal: true,
    category: "stairs",
    tags: ["Латунь", "Классика", "Два марша"],
  },
  {
    id: "baroque-led-gold-detail",
    fileName: "instagram/baroque-led-gold-detail.jpg",
    downloadFileName: "ALTYN-SAPA-baroque-led-gold-detail.jpg",
    contentType: "image/jpeg",
    publicUrl: "/catalog/stairs/instagram/baroque-led-gold-detail.jpg",
    title: "Барокко · детали подсветки и ограждения",
    material: "Золотые балясины · декор подступенков",
    note: "Реальный проект ALTYN SAPA · крупный план",
    sourceUrl: "https://www.instagram.com/altyn_sapa.company/p/DbmA_dpDckZ/",
    isReal: true,
    category: "stairs",
    tags: ["Латунь", "Детали", "Подсветка"],
  },
] as const;

export const FURNITURE_CATALOG_REFERENCES = [
  { id: "furniture-piramida", fileName: "table-1.jpg", downloadFileName: "ALTYN-SAPA-Piramida.jpg", contentType: "image/jpeg", publicUrl: "/catalog/furniture/table-1.jpg", title: "Стол Piramida", material: "Светлый или тёмный орех · 200–300 см", note: "Утверждённый каталог для офисного планшета", isReal: true, category: "furniture", tags: ["Столы", "Орех"] },
  { id: "furniture-crown", fileName: "table-2.jpg", downloadFileName: "ALTYN-SAPA-Crown.jpg", contentType: "image/jpeg", publicUrl: "/catalog/furniture/table-2.jpg", title: "Стол Crown", material: "Светлый или тёмный орех · 180–240 см", note: "Утверждённый каталог для офисного планшета", isReal: true, category: "furniture", tags: ["Столы", "Орех"] },
  { id: "furniture-japandi-lux", fileName: "table-10.jpg", downloadFileName: "ALTYN-SAPA-Japandi-Lux.jpg", contentType: "image/jpeg", publicUrl: "/catalog/furniture/table-10.jpg", title: "Стол Japandi Lux", material: "Светлый или тёмный орех · 120–190 см", note: "Утверждённый каталог для офисного планшета", isReal: true, category: "furniture", tags: ["Столы", "Japandi"] },
  { id: "furniture-praga", fileName: "table-12.jpg", downloadFileName: "ALTYN-SAPA-Praga.jpg", contentType: "image/jpeg", publicUrl: "/catalog/furniture/table-12.jpg", title: "Стол Praga", material: "Светлый или тёмный орех · 110–250 см", note: "Утверждённый каталог для офисного планшета", isReal: true, category: "furniture", tags: ["Столы", "Классика"] },
  { id: "furniture-armani", fileName: "chair-armani.jpg", downloadFileName: "ALTYN-SAPA-Armani.jpg", contentType: "image/jpeg", publicUrl: "/catalog/furniture/chair-armani.jpg", title: "Стул Armani", material: "Светлый или тёмный орех", note: "Утверждённый каталог для офисного планшета", isReal: true, category: "furniture", tags: ["Стулья", "Классика"] },
  { id: "furniture-tokyo", fileName: "chair-tokyo.jpg", downloadFileName: "ALTYN-SAPA-Tokyo.jpg", contentType: "image/jpeg", publicUrl: "/catalog/furniture/chair-tokyo.jpg", title: "Стул Tokyo", material: "Тёмный орех", note: "Утверждённый каталог для офисного планшета", isReal: true, category: "furniture", tags: ["Стулья", "Современный"] },
  { id: "furniture-scandi", fileName: "chair-scandi.jpg", downloadFileName: "ALTYN-SAPA-Scandi.jpg", contentType: "image/jpeg", publicUrl: "/catalog/furniture/chair-scandi.jpg", title: "Стул Scandi", material: "Светлый орех", note: "Утверждённый каталог для офисного планшета", isReal: true, category: "furniture", tags: ["Стулья", "Scandi"] },
  { id: "furniture-marsell", fileName: "chair-marsell-lux-dark.jpg", downloadFileName: "ALTYN-SAPA-Marsell-Lux.jpg", contentType: "image/jpeg", publicUrl: "/catalog/furniture/chair-marsell-lux-dark.jpg", title: "Стул Marsell Lux", material: "Светлый или тёмный орех", note: "Утверждённый каталог для офисного планшета", isReal: true, category: "furniture", tags: ["Стулья", "Премиум"] },
] as const;

export const PRODUCT_CATALOG_REFERENCES = [
  ...STAIR_CATALOG_REFERENCES,
  ...FURNITURE_CATALOG_REFERENCES,
] as const;

