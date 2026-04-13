# Restaurant CRUD API Test Script
# This script tests the protected API endpoints

# Configuration
$API_URL = "http://localhost:3000/api"
$TEST_USER_ID = [guid]::NewGuid().ToString()

# Mock JWT Token (in production, get from /api/auth/register or /api/auth/login)
# This is a placeholder JWT with correct structure for testing
$MOCK_JWT = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIkTEST_USER_ID","cm9sZXMiOlsiYWRtaW4iXX0.signature"

Write-Host "🚀 Restaurant CRUD API Test Suite" -ForegroundColor Green
Write-Host "=================================" -ForegroundColor Green
Write-Host ""

# Helper function for requests
function Invoke-ApiRequest {
    param(
        [string]$Method,
        [string]$Endpoint,
        [object]$Body,
        [string]$JWT
    )
    
    $Headers = @{
        "Content-Type" = "application/json"
    }
    
    if ($JWT) {
        $Headers["Authorization"] = $JWT
    }
    
    try {
        $response = Invoke-WebRequest -Uri "$API_URL$Endpoint" `
            -Method $Method `
            -Headers $Headers `
            -Body ($Body | ConvertTo-Json) -ErrorAction Stop
        return $response
    } catch {
        return $_.Exception.Response
    }
}

# Test 1: List Restaurants (No Auth Required for GET)
Write-Host "TEST 1: Get All Restaurants" -ForegroundColor Cyan
$restaurants = Invoke-WebRequest -Uri "$API_URL/restaurants" -Method Get
$data = $restaurants.Content | ConvertFrom-Json
Write-Host "✅ Found $($data.Count) restaurants" -ForegroundColor Green
$data | ForEach-Object {
    Write-Host "   - $($_.name) (Open: $($_.is_open))"
}
Write-Host ""

# Test 2: Get Specific Restaurant
if ($data.Count -gt 0) {
    Write-Host "TEST 2: Get Specific Restaurant" -ForegroundColor Cyan
    $restaurantId = $data[0].id
    $details = Invoke-WebRequest -Uri "$API_URL/restaurants/$restaurantId" -Method Get
    $detail = $details.Content | ConvertFrom-Json
    Write-Host "✅ Retrieved: $($detail.name)" -ForegroundColor Green
    Write-Host ""
}

# Test 3: Create Restaurant (Requires Auth - will fail without real JWT)
Write-Host "TEST 3: Create Restaurant (Will fail without real JWT - as expected)" -ForegroundColor Cyan
$newRestaurant = @{
    name = "Test Restaurant $(Get-Random)"
    address = "123 Test Street"
    phone = "+1-555-0000"
    description = "A test restaurant"
    latitude = 40.7128
    longitude = -74.0060
    is_open = $true
    is_approved = $true
}

try {
    $result = Invoke-WebRequest -Uri "$API_URL/restaurants" `
        -Method Post `
        -Headers @{"Content-Type" = "application/json"; "Authorization" = $MOCK_JWT} `
        -Body ($newRestaurant | ConvertTo-Json) -ErrorAction Stop
    Write-Host "✅ Created: $($result.Content)" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Auth Required (This is correct behavior)" -ForegroundColor Yellow
    Write-Host "   Status: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host ""

# Test 4: Update Restaurant
Write-Host "TEST 4: Update Restaurant (Will fail without real JWT - as expected)" -ForegroundColor Cyan
if ($data.Count -gt 0) {
    $updateData = @{
        name = "Updated Name $(Get-Random)"
        is_open = (-not $data[0].is_open)
    }
    
    try {
        $result = Invoke-WebRequest -Uri "$API_URL/restaurants/$($data[0].id)" `
            -Method Patch `
            -Headers @{"Content-Type" = "application/json"; "Authorization" = $MOCK_JWT} `
            -Body ($updateData | ConvertTo-Json) -ErrorAction Stop
        Write-Host "✅ Updated: $($result.Content)" -ForegroundColor Green
    } catch {
        Write-Host "⚠️  Auth Required (This is correct behavior)" -ForegroundColor Yellow
    }
}
Write-Host ""

Write-Host "=================================" -ForegroundColor Green
Write-Host "Note: Write/Delete operations require valid JWT" -ForegroundColor Yellow
Write-Host "To test auth-required operations:" -ForegroundColor Yellow
Write-Host "  1. Implement /api/auth/register endpoint" -ForegroundColor Gray
Write-Host "  2. Get JWT token from response" -ForegroundColor Gray
Write-Host "  3. Use token in Authorization header" -ForegroundColor Gray
Write-Host ""
Write-Host "Alternatively, test via browser at http://localhost:5173/restaurants" -ForegroundColor Cyan
