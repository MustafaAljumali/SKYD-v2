// High-fidelity agricultural preset images representing different crops under drone surveillance.
// Using compact, valid base64 image strings to ensure fast loading and zero external dependencies.

export interface DronePreset {
  id: string;
  labelAr: string;
  labelEn: string;
  descriptionAr: string;
  descriptionEn: string;
  color: string;
  // Compact valid JPEGs/PNGs of different representative colors
  base64: string; 
}

export const DRONE_PRESETS: DronePreset[] = [
  {
    id: "healthy_wheat",
    labelAr: "🌾 قمح سليم طبيعي (أخضر)",
    labelEn: "🌾 Healthy Field (Green vegetation)",
    descriptionAr: "حقل قمح يافع ذو مستويات رطوبة ونيتروجين ممتازة بالمسح الطيفي اللاسلكي.",
    descriptionEn: "Lush green wheat field showing optimal moisture indexes and vegetation reflection.",
    color: "border-emerald-500 bg-emerald-50/50 text-emerald-800",
    base64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAABGdBTUEAALGPC/xhBQAAADNJREFUKFNjvHr16n8GDAArKyvGf//+MUTExTFEgAqwAcapV6+CMAZ+Sog0Y0G6Ems80gwAAH9rInH3MefAAAAAAElFTkSuQmCC"
  },
  {
    id: "nitrogen_deficient",
    labelAr: "⚠️ نقص نيتروجين وإجهاد مائي (أصفر)",
    labelEn: "⚠️ Nutrient Deficiency (Yellow area)",
    descriptionAr: "كشف اصفرار تدريجي في الأوراق الوسطى ينم عن نقص التسميد الكيميائي المغذي.",
    descriptionEn: "Spotted chlorosis and yellowing. Initial indications of low active nitrogen indices.",
    color: "border-amber-500 bg-amber-50/50 text-amber-800",
    base64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAABGdBTUEAALGPC/xhBQAAADJJREFUKFNjvH79+n8GDAArKyvG//fvH0NEXBwjQIUKME69fv0/CGPgpySgGatR45FmAAA/yCJx96lByAAAAABJRU5ErkJggg=="
  },
  {
    id: "pest_infestation",
    labelAr: "🚨 بقعة مصابة بالآفة وسوسة القمح (أحمر)",
    labelEn: "🚨 Advanced Crop Blight (Red zone)",
    descriptionAr: "رصد تدهور سريع وتفشي الفطريات أو الحشرات المهددة لكامل أجزاء الساق والغطاء.",
    descriptionEn: "Highly damaged vegetative cells. Rust and leaf spot infections identified.",
    color: "border-rose-500 bg-rose-50/50 text-rose-800",
    base64: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAABGdBTUEAALGPC/xhBQAAADRJREFUKFNj/PTp0/8MGABWVlaM//+/f4yIeDhGgArVYJx69ep/EMbAT0lAM1ajxiPNAM68InHzw+QxAAAAAElFTkSuQmCC"
  }
];
