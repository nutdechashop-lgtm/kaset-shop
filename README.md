# kaset-shop

ระบบขายหน้าร้าน (เงินสด / เงินเชื่อ ดอกเบี้ยรายวัน สต๊อก) แทนโปรแกรมเก่า programkaset ใช้ได้หลายร้าน แยกข้อมูลกันทั้งหมด

- `docs/` หน้าเว็บ (GitHub Pages: branch main, โฟลเดอร์ /docs)
- `src/interest.js` คิดดอกเบี้ย: เงินต้น × อัตรา% × วัน ÷ 30 ตัดดอกก่อนต้น บิลเก่าก่อน
- `src/shop.js` ขาย / รับชำระ / เลขที่บิล
- `src/importer.js` อ่านไฟล์ Chemi2003NEW.MDB ของโปรแกรมเก่า
- `firestore.rules` กฎความปลอดภัยของฐานข้อมูล (วางใน Firebase console → Firestore → Rules)
- ข้อมูลร้านอยู่ใน Firebase โปรเจกต์ `shop-system-c3a32` **ไม่เก็บใน GitHub**

เปิด `index.html?local=1` = โหมดทดสอบ เก็บข้อมูลในเบราว์เซอร์เครื่องนั้นอย่างเดียว

```
npm install
npm run build
npm test -- <path>/Chemi2003NEW.MDB
```
