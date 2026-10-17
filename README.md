# kaset-shop

ระบบขายหน้าร้าน (เงินสด / เงินเชื่อ ดอกเบี้ยรายวัน สต๊อก) แทนโปรแกรมเก่า programkaset ใช้ได้ 4 ร้าน แยกข้อมูลกันทั้งหมด

- `docs/` หน้าเว็บที่เปิดผ่าน GitHub Pages
- `src/` โค้ดคำนวณดอกเบี้ย (`interest.js`) และตัวอ่านไฟล์โปรแกรมเก่า (`importer.js`)
- ข้อมูลร้านเก็บใน Firebase (โปรเจกต์ `shop-system-c3a32`) และไฟล์สำรองบนเครื่องร้าน **ไม่เก็บใน GitHub**

```
npm install
npm run build              # สร้าง docs/js/importer.bundle.js
npm test -- <path>/Chemi2003NEW.MDB
```
