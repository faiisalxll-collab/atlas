# ATLAS — The Open Source Universe

عالم معرفي رقمي ثلاثي الأبعاد لاستكشاف مكتبة مستودعات GitHub المختارة بعناية في مجالات الذكاء الاصطناعي والتقنيات المتقدمة، مبني باستخدام **TypeScript** و**Vite** و**Three.js** و**Graphology** و**Fuse.js**، ومصمم للعمل على **GitHub Pages** بتكلفة تشغيل صفرية.

## المعمارية والخصائص الهندسية

- **فضاء ثلاثي الأبعاد حقيقي (`X, Y, Z`):** نواة مركزية (`ATLAS`) تتفرع إلى 7 مجالات معرفية كبرى، ثم إلى التصنيفات الفعلية من Google Sheets، ثم إلى نجوم المستودعات عبر توزيع كروي فيبوناتشي حتمي (`Deterministic Fibonacci Sphere`).
- **تفرع وطي فراغي سلس (3D Branch Expansion/Collapse):** تتمدد العقد وتنطوي في الفضاء ثلاثي الأبعاد عند النقر مع منع تداخل أسماء النجوم على الشاشة (`Screen-Space Bounding Box Collision Avoidance`) وتقريب دلالي (`Semantic Zoom`) يغيّر كثافة التفاصيل حسب المسافة.
- **علاقات معرفية موثقة ومسارات استكشاف (`Discovery Trails`):** تمييز واضح بين الاشتراك التقني والتشابه الوظيفي والتكامل المقترح مع عرض سبب الربط ومصدر الدليل، ونبضات ضوئية على المسارات النشطة.
- **ثبات مواقع المجرة (`Incremental Layout`):** يحفظ ملف `public/data/positions.json` مواقع النجوم القديمة حتى لا تتبعثر المجرة عند إضافة مستودعات جديدة.
- **مزامنة تلقائية من Google Sheets:** سكربت `scripts/sync.py` يستخرج جميع الصفوف والروابط الفعلية (بما فيها صيغ `HYPERLINK`)، ويحافظ على التواريخ الفارغة دون اختلاق، ويولّد صفحات معاينة ثابتة لـ Open Graph تحت `public/r/`.

## التشغيل المحلي (Local Development)

```bash
# 1. تثبيت الاعتماديات
npm install

# 2. تشغيل خادم التطوير المحلي
npm run dev

# 3. تشغيل الاختبارات الآلية
npm run test

# 4. بناء النسخة النهائية للنشر
npm run build
```

## ربط Google Sheets والتحديث التلقائي عبر GitHub Actions

1. أنشئ مستودعًا مستقلًا باسم `atlas` تحت حساب `faiisalxll-collab` وارفع إليه ملفات المشروع.
2. أنشئ حساب خدمة في Google Cloud بصلاحية قراءة فقط (`Sheets API Read-Only`) وشارك معه ورقة Google Sheets.
3. أضف محتوى ملف الاعتماد JSON في إعدادات المستودع على GitHub:
   `Settings -> Secrets and variables -> Actions -> New repository secret`
   باسم: `GOOGLE_SERVICE_ACCOUNT_JSON`.
4. من `Settings -> Pages` اختر المصدر: **GitHub Actions**.
5. سيعمل مسار `.github/workflows/sync-and-deploy.yml` تلقائيًا كل يوم (أو يدويًا عبر `workflow_dispatch`) لمزامنة الجدول وبناء الموقع ونشره على:
   `https://faiisalxll-collab.github.io/atlas/`

## التراخيص والإسناد

- Three.js (MIT License)
- Graphology (MIT License)
- Fuse.js (Apache-2.0 License)
