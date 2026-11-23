// ============================================================
// Google Apps Script code for the Shop Owner's Google Sheet
// ============================================================
// Instructions for the Client / Shop Owner:
// 1. Open your Google Sheet
// 2. Go to Extensions > Apps Script
// 3. Paste the code below and click Save
// 4. Click Deploy > New deployment > Select type: "Web app"
// 5. Execute as: "Me", Who has access: "Anyone"
// 6. Click Deploy and copy the Web app URL
// 7. Add this URL to your environment variable: GOOGLE_SHEETS_WEBHOOK_URL

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // Create header row if empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Order ID", 
        "Date", 
        "Customer Name", 
        "Phone", 
        "Address", 
        "Items", 
        "Total Amount", 
        "Payment Method", 
        "Status", 
        "Notes"
      ]);
    }
    
    var data = JSON.parse(e.postData.contents);
    
    sheet.appendRow([
      data.orderId || "",
      data.date || "",
      data.customerName || "",
      "'" + (data.customerPhone || ""),
      data.address || "",
      data.items || "",
      data.totalAmount || "",
      data.paymentMethod || "",
      data.status || "Pending",
      data.notes || ""
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
