# Reader-ээс ERP рүү хоолны тоо татах гэрээ

Автомат илгээлт байхгүй. ERP-ийн эрхтэй ажилтан огнооны интервал сонгоод **Reader-ээс татах** үйлдэл хийхэд ERP сервер Reader-ийн дараах API-г дуудна.

```http
GET {READER_MEAL_EXPORT_URL}?dateFrom=2026-09-01&dateTo=2026-09-27
Authorization: Bearer <READER_MEAL_READ_TOKEN>
Accept: application/json
```

`READER_MEAL_EXPORT_URL` нь Reader талын HTTPS endpoint-ийн **бүтэн URL** (жишээ нь `/api/integrations/meal-counts` замтай), `READER_MEAL_READ_TOKEN` нь ERP серверийн Secret. Reader талд ижил токеныг өөрийн Secret-д хадгалж, зөвхөн энэ интеграцийн унших эрхэд ашиглана. Токеныг браузерт, кодод, чатад болон логт бичихгүй.

Reader-ийн `200` хариу:

```json
{
  "records": [
    { "date": "2026-09-27", "mealType": "Өдрийн хоол", "count": 125 },
    { "date": "2026-09-27", "mealType": "Оройн хоол", "count": 97 }
  ]
}
```

- `date` нь хүссэн интервалд багтах `YYYY-MM-DD` бодит өдөр, `mealType` нь хоосон биш хоолны төрөл, `count` нь 0–2,147,483,647 хоорондох бүхэл **эцсийн нийт тоо**. 0–5000 мөр байж болно; бүртгэлгүй хугацаанд `{ "records": [] }` буцаана.
- ERP нь өдөр + хэвийн болгосон хоолны төрлөөр нэг мөр хадгална. Ижил интервалыг дахин татахад давхар нэмэхгүй; Reader-ийн шинэ нийт тоогоор өмнөхийг солино. Хариунд дурдаагүй бусад мөрийг арилгахгүй. Тэг болсон төрлийг `count: 0` гэж илгээнэ.
- Reader хариуг бүрэн шалгасны дараа л ERP хадгална. Reader-ийн алдаа, буруу хариу, холболтын алдаанд ERP `502`, ERP-ийн тохиргоо дутуу бол `503` буцааж, амжилттай мэт харуулахгүй.
- ERP талын ажилтны session-оор `POST /api/meal-counts/import` хүсэлтэд `{ "dateFrom": "YYYY-MM-DD", "dateTo": "YYYY-MM-DD" }` илгээнэ; зөвхөн admin болон warehouse импорт эхлүүлнэ. Амжилттай бол `{ "received": <тоо>, "updatedAt": <ISO хугацаа> }`. Бусад эрхтэй ажилтан `GET /api/meal-counts?dateFrom=...&dateTo=...`-ээр хадгалагдсан дүнг харна.

**Идэвхжүүлэх нөхцөл:** ERP-ийн PR нэгтгэгдэж production migration хийгдсэн, Reader-ийн хамгаалалттай endpoint бэлэн болсон, хоёр талын Secret болон Reader endpoint URL тохируулагдсаны дараа л production-д бодит таталт ажиллана. Өдөр тутмын scheduler эсвэл автомат push байхгүй.