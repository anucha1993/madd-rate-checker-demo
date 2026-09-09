# UPS Rate Checker Demo (Standalone)

เครื่องมือทดสอบ/เทียบราคา UPS แบบ **standalone** — รันตัวเองได้เลย ไม่ต้องพึ่งพา
`madd-api-gateway`, `madd-admin`, หรือฐานข้อมูลใดๆ ของโปรเจกต์หลัก พูดคุยกับ UPS
Sandbox (CIE) โดยตรงเท่านั้น

## มีไว้ทำอะไร
- ยิงราคาไปที่ UPS Rating API จริง (Sandbox) พร้อมกัน 2 แบบ: **Published Rate** (ราคาป้าย)
  และ **Negotiated Rate** (ราคาต่อรอง)
- ให้กรอก **ราคาที่คุณคำนวณเอง (Manual)** เพื่อเทียบว่าตรงกับราคาที่ UPS ตอบกลับมาหรือไม่
  (มี badge ✓ ตรงกัน / ✕ ต่างกัน ให้ดูทันที)
- ฟอร์มเปิดให้กรอกได้อิสระทุกช่อง (ต้นทาง/ปลายทาง/น้ำหนัก/ขนาด/บัญชี UPS) ไม่ผูกกับ
  ข้อมูลใดๆ ของระบบหลัก

## วิธีรัน
```powershell
cd madd-rate-checker-demo
npm install
npm run dev
```
เปิดเบราว์เซอร์ไปที่ **http://localhost:4100**

## ตั้งค่า (.env)
คัดลอกจาก `.env.example`:
- `UPS_AUTH_URL`, `UPS_API_URL` — ปกติใช้ค่า sandbox (`wwwcie.ups.com`) ตามค่า default อยู่แล้ว
- `DEFAULT_UPS_CLIENT_ID` / `DEFAULT_UPS_CLIENT_SECRET` / `DEFAULT_UPS_SHIPPER_NUMBER` —
  (ไม่บังคับ) ใส่ไว้แค่ให้ฟอร์มเติมค่าเริ่มต้นให้อัตโนมัติ ยังแก้ในหน้าเว็บได้เสมอ

## หมายเหตุ
- ไม่มีการเชื่อมต่อฐานข้อมูลหรือเรียก API ของ `madd-api-gateway` เลย — ปิดระบบหลักทั้งหมด
  ก็ยังใช้เครื่องมือนี้ได้ตราบใดที่เชื่อมอินเทอร์เน็ตไปหา UPS ได้
- ค่า tolerance สำหรับตัดสิน "ตรงกัน" ตอนนี้ตั้งไว้ที่ ±1 บาท แก้ได้ที่
  `MATCH_TOLERANCE_BAHT` ใน `public/app.js`
