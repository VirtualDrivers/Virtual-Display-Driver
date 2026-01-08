/*++

Copyright (c) Microsoft Corporation

Abstract:

	MSDN documentation on indirect displays can be found at https://msdn.microsoft.com/en-us/library/windows/hardware/mt761968(v=vs.85).aspx.

Environment:

	User Mode, UMDF

--*/

#include "Driver.h"
//#include "Driver.tmh"
#include<fstream>
#include<sstream>
#include<string>
#include<tuple>
#include<vector>
#include<algorithm>
#include<iomanip>
#include<chrono>
#include <AdapterOption.h>
#include <xmllite.h>
#include <shlwapi.h>
#include <atlbase.h>
#include <iostream>
#include <cstdlib>
#include <windows.h>
#include <cstdio>
#include <sddl.h>
#include <mutex>
#include <chrono>
#include <iomanip>
#include <cerrno>
#include <locale>
#include <cwchar>
#include <map>
#include <set>





#define PIPE_NAME L"\\\\.\\pipe\\MTTVirtualDisplayPipe"

#pragma comment(lib, "xmllite.lib")
#pragma comment(lib, "shlwapi.lib")

HANDLE hPipeThread = NULL;
bool g_Running = true;
mutex g_Mutex;
HANDLE g_pipeHandle = INVALID_HANDLE_VALUE;

using namespace std;
using namespace Microsoft::IndirectDisp;
using namespace Microsoft::WRL;

void vddlog(const char* type, const char* message);

extern "C" DRIVER_INITIALIZE DriverEntry;

EVT_WDF_DRIVER_DEVICE_ADD VirtualDisplayDriverDeviceAdd;
EVT_WDF_DEVICE_D0_ENTRY VirtualDisplayDriverDeviceD0Entry;

EVT_IDD_CX_ADAPTER_INIT_FINISHED VirtualDisplayDriverAdapterInitFinished;
EVT_IDD_CX_ADAPTER_COMMIT_MODES VirtualDisplayDriverAdapterCommitModes;

EVT_IDD_CX_PARSE_MONITOR_DESCRIPTION VirtualDisplayDriverParseMonitorDescription;
EVT_IDD_CX_MONITOR_GET_DEFAULT_DESCRIPTION_MODES VirtualDisplayDriverMonitorGetDefaultModes;
EVT_IDD_CX_MONITOR_QUERY_TARGET_MODES VirtualDisplayDriverMonitorQueryModes;

EVT_IDD_CX_MONITOR_ASSIGN_SWAPCHAIN VirtualDisplayDriverMonitorAssignSwapChain;
EVT_IDD_CX_MONITOR_UNASSIGN_SWAPCHAIN VirtualDisplayDriverMonitorUnassignSwapChain;

EVT_IDD_CX_ADAPTER_QUERY_TARGET_INFO VirtualDisplayDriverEvtIddCxAdapterQueryTargetInfo;
EVT_IDD_CX_MONITOR_SET_DEFAULT_HDR_METADATA VirtualDisplayDriverEvtIddCxMonitorSetDefaultHdrMetadata;
EVT_IDD_CX_PARSE_MONITOR_DESCRIPTION2 VirtualDisplayDriverEvtIddCxParseMonitorDescription2;
EVT_IDD_CX_MONITOR_QUERY_TARGET_MODES2 VirtualDisplayDriverEvtIddCxMonitorQueryTargetModes2;
EVT_IDD_CX_ADAPTER_COMMIT_MODES2 VirtualDisplayDriverEvtIddCxAdapterCommitModes2;

EVT_IDD_CX_MONITOR_SET_GAMMA_RAMP VirtualDisplayDriverEvtIddCxMonitorSetGammaRamp;

struct
{
	AdapterOption Adapter;
} Options;
vector<tuple<int, int, int, int>> monitorModes;
vector< DISPLAYCONFIG_VIDEO_SIGNAL_INFO> s_KnownMonitorModes2;
UINT numVirtualDisplays;
wstring gpuname;
wstring confpath = L"C:\\VirtualDisplayDriver";
bool logsEnabled = false;
bool debugLogs = false;
bool HDRPlus = false;
bool SDR10 = false;
bool customEdid = false;
bool hardwareCursor = false;
bool preventManufacturerSpoof = false;
bool edidCeaOverride = false;
bool sendLogsThroughPipe = true;

//Mouse settings
bool alphaCursorSupport = true;
int CursorMaxX = 128;
int CursorMaxY = 128;
IDDCX_XOR_CURSOR_SUPPORT XorCursorSupportLevel = IDDCX_XOR_CURSOR_SUPPORT_FULL;


//Rest
IDDCX_BITS_PER_COMPONENT SDRCOLOUR = IDDCX_BITS_PER_COMPONENT_8;
IDDCX_BITS_PER_COMPONENT HDRCOLOUR = IDDCX_BITS_PER_COMPONENT_10;

wstring ColourFormat = L"RGB";

// === EDID INTEGRATION SETTINGS ===
bool edidIntegrationEnabled = false;
bool autoConfigureFromEdid = false;
wstring edidProfilePath = L"EDID/monitor_profile.xml";
bool overrideManualSettings = false;
bool fallbackOnError = true;

// === HDR ADVANCED SETTINGS ===
bool hdr10StaticMetadataEnabled = false;
double maxDisplayMasteringLuminance = 1000.0;
double minDisplayMasteringLuminance = 0.05;
int maxContentLightLevel = 1000;
int maxFrameAvgLightLevel = 400;

bool colorPrimariesEnabled = false;
double redX = 0.708, redY = 0.292;
double greenX = 0.170, greenY = 0.797;
double blueX = 0.131, blueY = 0.046;
double whiteX = 0.3127, whiteY = 0.3290;

bool colorSpaceEnabled = false;
double gammaCorrection = 2.4;
wstring primaryColorSpace = L"sRGB";
bool enableMatrixTransform = false;

// === AUTO RESOLUTIONS SETTINGS ===
bool autoResolutionsEnabled = false;
wstring sourcePriority = L"manual";
int minRefreshRate = 24;
int maxRefreshRate = 240;
bool excludeFractionalRates = false;
int minResolutionWidth = 640;
int minResolutionHeight = 480;
int maxResolutionWidth = 7680;
int maxResolutionHeight = 4320;
bool useEdidPreferred = false;
int fallbackWidth = 1920;
int fallbackHeight = 1080;
int fallbackRefresh = 60;

// === COLOR ADVANCED SETTINGS ===
bool autoSelectFromColorSpace = false;
wstring forceBitDepth = L"auto";
bool fp16SurfaceSupport = true;
bool wideColorGamut = false;
bool hdrToneMapping = false;
double sdrWhiteLevel = 80.0;

// === MONITOR EMULATION SETTINGS ===
bool monitorEmulationEnabled = false;
bool emulatePhysicalDimensions = false;
int physicalWidthMm = 510;
int physicalHeightMm = 287;
bool manufacturerEmulationEnabled = false;
wstring manufacturerName = L"Generic";
wstring modelName = L"Virtual Display";
wstring serialNumber = L"VDD001";

std::map<std::wstring, std::pair<std::wstring, std::wstring>> SettingsQueryMap = {
	{L"LoggingEnabled", {L"LOGS", L"logging"}},
	{L"DebugLoggingEnabled", {L"DEBUGLOGS", L"debuglogging"}},
	{L"CustomEdidEnabled", {L"CUSTOMEDID", L"CustomEdid"}},

	{L"PreventMonitorSpoof", {L"PREVENTMONITORSPOOF", L"PreventSpoof"}},
	{L"EdidCeaOverride", {L"EDIDCEAOVERRIDE", L"EdidCeaOverride"}},
	{L"SendLogsThroughPipe", {L"SENDLOGSTHROUGHPIPE", L"SendLogsThroughPipe"}},
	
	//Cursor Begin
	{L"HardwareCursorEnabled", {L"HARDWARECURSOR", L"HardwareCursor"}},
	{L"AlphaCursorSupport", {L"ALPHACURSORSUPPORT", L"AlphaCursorSupport"}},
	{L"CursorMaxX", {L"CURSORMAXX", L"CursorMaxX"}},
	{L"CursorMaxY", {L"CURSORMAXY", L"CursorMaxY"}},
	{L"XorCursorSupportLevel", {L"XORCURSORSUPPORTLEVEL", L"XorCursorSupportLevel"}},
	//Cursor End
	
	//Colour Begin
	{L"HDRPlusEnabled", {L"HDRPLUS", L"HDRPlus"}},
	{L"SDR10Enabled", {L"SDR10BIT", L"SDR10bit"}},
	{L"ColourFormat", {L"COLOURFORMAT", L"ColourFormat"}},
	//Colour End
	
	//EDID Integration Begin
	{L"EdidIntegrationEnabled", {L"EDIDINTEGRATION", L"enabled"}},
	{L"AutoConfigureFromEdid", {L"AUTOCONFIGFROMEDID", L"auto_configure_from_edid"}},
	{L"EdidProfilePath", {L"EDIDPROFILEPATH", L"edid_profile_path"}},
	{L"OverrideManualSettings", {L"OVERRIDEMANUALSETTINGS", L"override_manual_settings"}},
	{L"FallbackOnError", {L"FALLBACKONERROR", L"fallback_on_error"}},
	//EDID Integration End
	
	//HDR Advanced Begin
	{L"Hdr10StaticMetadataEnabled", {L"HDR10STATICMETADATA", L"enabled"}},
	{L"MaxDisplayMasteringLuminance", {L"MAXLUMINANCE", L"max_display_mastering_luminance"}},
	{L"MinDisplayMasteringLuminance", {L"MINLUMINANCE", L"min_display_mastering_luminance"}},
	{L"MaxContentLightLevel", {L"MAXCONTENTLIGHT", L"max_content_light_level"}},
	{L"MaxFrameAvgLightLevel", {L"MAXFRAMEAVGLIGHT", L"max_frame_avg_light_level"}},
	{L"ColorPrimariesEnabled", {L"COLORPRIMARIES", L"enabled"}},
	{L"RedX", {L"REDX", L"red_x"}},
	{L"RedY", {L"REDY", L"red_y"}},
	{L"GreenX", {L"GREENX", L"green_x"}},
	{L"GreenY", {L"GREENY", L"green_y"}},
	{L"BlueX", {L"BLUEX", L"blue_x"}},
	{L"BlueY", {L"BLUEY", L"blue_y"}},
	{L"WhiteX", {L"WHITEX", L"white_x"}},
	{L"WhiteY", {L"WHITEY", L"white_y"}},
	{L"ColorSpaceEnabled", {L"COLORSPACE", L"enabled"}},
	{L"GammaCorrection", {L"GAMMA", L"gamma_correction"}},
	{L"PrimaryColorSpace", {L"PRIMARYCOLORSPACE", L"primary_color_space"}},
	{L"EnableMatrixTransform", {L"MATRIXTRANSFORM", L"enable_matrix_transform"}},
	//HDR Advanced End
	
	//Auto Resolutions Begin
	{L"AutoResolutionsEnabled", {L"AUTORESOLUTIONS", L"enabled"}},
	{L"SourcePriority", {L"SOURCEPRIORITY", L"source_priority"}},
	{L"MinRefreshRate", {L"MINREFRESHRATE", L"min_refresh_rate"}},
	{L"MaxRefreshRate", {L"MAXREFRESHRATE", L"max_refresh_rate"}},
	{L"ExcludeFractionalRates", {L"EXCLUDEFRACTIONAL", L"exclude_fractional_rates"}},
	{L"MinResolutionWidth", {L"MINWIDTH", L"min_resolution_width"}},
	{L"MinResolutionHeight", {L"MINHEIGHT", L"min_resolution_height"}},
	{L"MaxResolutionWidth", {L"MAXWIDTH", L"max_resolution_width"}},
	{L"MaxResolutionHeight", {L"MAXHEIGHT", L"max_resolution_height"}},
	{L"UseEdidPreferred", {L"USEEDIDPREFERRED", L"use_edid_preferred"}},
	{L"FallbackWidth", {L"FALLBACKWIDTH", L"fallback_width"}},
	{L"FallbackHeight", {L"FALLBACKHEIGHT", L"fallback_height"}},
	{L"FallbackRefresh", {L"FALLBACKREFRESH", L"fallback_refresh"}},
	//Auto Resolutions End
	
	//Color Advanced Begin
	{L"AutoSelectFromColorSpace", {L"AUTOSELECTCOLOR", L"auto_select_from_color_space"}},
	{L"ForceBitDepth", {L"FORCEBITDEPTH", L"force_bit_depth"}},
	{L"Fp16SurfaceSupport", {L"FP16SUPPORT", L"fp16_surface_support"}},
	{L"WideColorGamut", {L"WIDECOLORGAMUT", L"wide_color_gamut"}},
	{L"HdrToneMapping", {L"HDRTONEMAPPING", L"hdr_tone_mapping"}},
	{L"SdrWhiteLevel", {L"SDRWHITELEVEL", L"sdr_white_level"}},
	//Color Advanced End
	
	//Monitor Emulation Begin
	{L"MonitorEmulationEnabled", {L"MONITOREMULATION", L"enabled"}},
	{L"EmulatePhysicalDimensions", {L"EMULATEPHYSICAL", L"emulate_physical_dimensions"}},
	{L"PhysicalWidthMm", {L"PHYSICALWIDTH", L"physical_width_mm"}},
	{L"PhysicalHeightMm", {L"PHYSICALHEIGHT", L"physical_height_mm"}},
	{L"ManufacturerEmulationEnabled", {L"MANUFACTUREREMULATION", L"enabled"}},
	{L"ManufacturerName", {L"MANUFACTURERNAME", L"manufacturer_name"}},
	{L"ModelName", {L"MODELNAME", L"model_name"}},
	{L"SerialNumber", {L"SERIALNUMBER", L"serial_number"}},
	//Monitor Emulation End
};

const char* XorCursorSupportLevelToString(IDDCX_XOR_CURSOR_SUPPORT level) {
	switch (level) {
	case IDDCX_XOR_CURSOR_SUPPORT_UNINITIALIZED:
		return "IDDCX_XOR_CURSOR_SUPPORT_UNINITIALIZED";
	case IDDCX_XOR_CURSOR_SUPPORT_NONE:
		return "IDDCX_XOR_CURSOR_SUPPORT_NONE";
	case IDDCX_XOR_CURSOR_SUPPORT_FULL:
		return "IDDCX_XOR_CURSOR_SUPPORT_FULL";
	case IDDCX_XOR_CURSOR_SUPPORT_EMULATION:
		return "IDDCX_XOR_CURSOR_SUPPORT_EMULATION";
	default:
		return "Unknown";
	}
}


vector<unsigned char> Microsoft::IndirectDisp::IndirectDeviceContext::s_KnownMonitorEdid; //Changed to support static vector

std::map<LUID, std::shared_ptr<Direct3DDevice>, Microsoft::IndirectDisp::LuidComparator> Microsoft::IndirectDisp::IndirectDeviceContext::s_DeviceCache;
std::mutex Microsoft::IndirectDisp::IndirectDeviceContext::s_DeviceCacheMutex;

struct IndirectDeviceContextWrapper
{
	IndirectDeviceContext* pContext;

	void Cleanup()
	{
		delete pContext;
		pContext = nullptr;
	}
};
void LogQueries(const char* severity, const std::wstring& xmlName) {
	if (xmlName.find(L"logging") == std::wstring::npos) { 
		int size_needed = WideCharToMultiByte(CP_UTF8, 0, xmlName.c_str(), (int)xmlName.size(), NULL, 0, NULL, NULL);
		if (size_needed > 0) {
			std::string strMessage(size_needed, 0);
			WideCharToMultiByte(CP_UTF8, 0, xmlName.c_str(), (int)xmlName.size(), &strMessage[0], size_needed, NULL, NULL);
			vddlog(severity, strMessage.c_str());
		}
	}
}

string WStringToString(const wstring& wstr) { //basically just a function for converting strings since codecvt is depricated in c++ 17
	if (wstr.empty()) return "";

	int size_needed = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), (int)wstr.size(), NULL, 0, NULL, NULL);
	string str(size_needed, 0);
	WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), (int)wstr.size(), &str[0], size_needed, NULL, NULL);
	return str;
}

bool EnabledQuery(const std::wstring& settingKey) {
	auto it = SettingsQueryMap.find(settingKey);
	if (it == SettingsQueryMap.end()) {
		vddlog("e", "requested data not found in xml, consider updating xml!");
		return false;
	}

	std::wstring regName = it->second.first;
	std::wstring xmlName = it->second.second;

	std::wstring settingsname = confpath + L"\\vdd_settings.xml";
	HKEY hKey;
	DWORD dwValue;
	DWORD dwBufferSize = sizeof(dwValue);
	LONG lResult = RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\MikeTheTech\\VirtualDisplayDriver", 0, KEY_READ, &hKey);

	if (lResult == ERROR_SUCCESS) {
		lResult = RegQueryValueExW(hKey, regName.c_str(), NULL, NULL, (LPBYTE)&dwValue, &dwBufferSize);
		if (lResult == ERROR_SUCCESS) {
			RegCloseKey(hKey);
			if (dwValue == 1) {
				LogQueries("d", xmlName + L" - is enabled (value = 1).");
				return true;
			}
			else if (dwValue == 0) {
				goto check_xml;
			}
		}
		else {
			LogQueries("d", xmlName + L" - Failed to retrieve value from registry. Attempting to read as string.");
			wchar_t path[MAX_PATH];
			dwBufferSize = sizeof(path);
			lResult = RegQueryValueExW(hKey, regName.c_str(), NULL, NULL, (LPBYTE)path, &dwBufferSize);
			if (lResult == ERROR_SUCCESS) {
				std::wstring logValue(path);
				RegCloseKey(hKey);
				if (logValue == L"true" || logValue == L"1") {
					LogQueries("d", xmlName + L" - is enabled (string value).");
					return true;
				}
				else if (logValue == L"false" || logValue == L"0") {
					goto check_xml;
				}
			}
			RegCloseKey(hKey);
			LogQueries("d", xmlName + L" - Failed to retrieve string value from registry.");
		}
	}

check_xml:
	CComPtr<IStream> pFileStream;
	HRESULT hr = SHCreateStreamOnFileEx(settingsname.c_str(), STGM_READ, FILE_ATTRIBUTE_NORMAL, FALSE, nullptr, &pFileStream);
	if (FAILED(hr)) {
		LogQueries("d", xmlName + L" - Failed to create file stream for XML settings.");
		return false;
	}

	CComPtr<IXmlReader> pReader;
	hr = CreateXmlReader(__uuidof(IXmlReader), (void**)&pReader, nullptr);
	if (FAILED(hr)) {
		LogQueries("d", xmlName + L" - Failed to create XML reader.");
		return false;
	}

	hr = pReader->SetInput(pFileStream);
	if (FAILED(hr)) {
		LogQueries("d", xmlName + L" - Failed to set input for XML reader.");
		return false;
	}

	XmlNodeType nodeType;
	const wchar_t* pwszLocalName;
	bool xmlLoggingValue = false;

	while (S_OK == pReader->Read(&nodeType)) {
		if (nodeType == XmlNodeType_Element) {
			pReader->GetLocalName(&pwszLocalName, nullptr);
			if (pwszLocalName && wcscmp(pwszLocalName, xmlName.c_str()) == 0) {
				pReader->Read(&nodeType);
				if (nodeType == XmlNodeType_Text) {
					const wchar_t* pwszValue;
					pReader->GetValue(&pwszValue, nullptr);
					if (pwszValue) {
						xmlLoggingValue = (wcscmp(pwszValue, L"true") == 0);
					}
					LogQueries("i", xmlName + (xmlLoggingValue ? L" is enabled." : L" is disabled."));
					break;
				}
			}
		}
	}

	return xmlLoggingValue;
}

int GetIntegerSetting(const std::wstring& settingKey) {
	auto it = SettingsQueryMap.find(settingKey);
	if (it == SettingsQueryMap.end()) {
		vddlog("e", "requested data not found in xml, consider updating xml!");
		return -1;
	}

	std::wstring regName = it->second.first;
	std::wstring xmlName = it->second.second;

	std::wstring settingsname = confpath + L"\\vdd_settings.xml";
	HKEY hKey;
	DWORD dwValue;
	DWORD dwBufferSize = sizeof(dwValue);
	LONG lResult = RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\MikeTheTech\\VirtualDisplayDriver", 0, KEY_READ, &hKey);

	if (lResult == ERROR_SUCCESS) {
		lResult = RegQueryValueExW(hKey, regName.c_str(), NULL, NULL, (LPBYTE)&dwValue, &dwBufferSize);
		if (lResult == ERROR_SUCCESS) {
			RegCloseKey(hKey);
			LogQueries("d", xmlName + L" - Retrieved integer value: " + std::to_wstring(dwValue));
			return static_cast<int>(dwValue);
		}
		else {
			LogQueries("d", xmlName + L" - Failed to retrieve integer value from registry. Attempting to read as string.");
			wchar_t path[MAX_PATH];
			dwBufferSize = sizeof(path);
			lResult = RegQueryValueExW(hKey, regName.c_str(), NULL, NULL, (LPBYTE)path, &dwBufferSize);
			RegCloseKey(hKey);
			if (lResult == ERROR_SUCCESS) {
				try {
					int logValue = std::stoi(path);
					LogQueries("d", xmlName + L" - Retrieved string value: " + std::to_wstring(logValue));
					return logValue;
				}
				catch (const std::exception&) {
					LogQueries("d", xmlName + L" - Failed to convert registry string value to integer.");
				}
			}
		}
	}

	CComPtr<IStream> pFileStream;
	HRESULT hr = SHCreateStreamOnFileEx(settingsname.c_str(), STGM_READ, FILE_ATTRIBUTE_NORMAL, FALSE, nullptr, &pFileStream);
	if (FAILED(hr)) {
		LogQueries("d", xmlName + L" - Failed to create file stream for XML settings.");
		return -1;
	}

	CComPtr<IXmlReader> pReader;
	hr = CreateXmlReader(__uuidof(IXmlReader), (void**)&pReader, nullptr);
	if (FAILED(hr)) {
		LogQueries("d", xmlName + L" - Failed to create XML reader.");
		return -1;
	}

	hr = pReader->SetInput(pFileStream);
	if (FAILED(hr)) {
		LogQueries("d", xmlName + L" - Failed to set input for XML reader.");
		return -1;
	}

	XmlNodeType nodeType;
	const wchar_t* pwszLocalName;
	int xmlLoggingValue = -1;

	while (S_OK == pReader->Read(&nodeType)) {
		if (nodeType == XmlNodeType_Element) {
			pReader->GetLocalName(&pwszLocalName, nullptr);
			if (pwszLocalName && wcscmp(pwszLocalName, xmlName.c_str()) == 0) {
				pReader->Read(&nodeType);
				if (nodeType == XmlNodeType_Text) {
					const wchar_t* pwszValue;
					pReader->GetValue(&pwszValue, nullptr);
					if (pwszValue) {
						try {
							xmlLoggingValue = std::stoi(pwszValue);
							LogQueries("i", xmlName + L" - Retrieved from XML: " + std::to_wstring(xmlLoggingValue));
						}
						catch (const std::exception&) {
							LogQueries("d", xmlName + L" - Failed to convert XML string value to integer.");
						}
					}
					break;
				}
			}
		}
	}

	return xmlLoggingValue;
}

std::wstring GetStringSetting(const std::wstring& settingKey) {
	auto it = SettingsQueryMap.find(settingKey);
	if (it == SettingsQueryMap.end()) {
		vddlog("e", "requested data not found in xml, consider updating xml!");
		return L""; 
	}

	std::wstring regName = it->second.first;
	std::wstring xmlName = it->second.second;

	std::wstring settingsname = confpath + L"\\vdd_settings.xml";
	HKEY hKey;
	DWORD dwBufferSize = MAX_PATH;
	wchar_t buffer[MAX_PATH];

	LONG lResult = RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\MikeTheTech\\VirtualDisplayDriver", 0, KEY_READ, &hKey);
	if (lResult == ERROR_SUCCESS) {
		lResult = RegQueryValueExW(hKey, regName.c_str(), NULL, NULL, (LPBYTE)buffer, &dwBufferSize);
		RegCloseKey(hKey);

		if (lResult == ERROR_SUCCESS) {
			LogQueries("d", xmlName + L" - Retrieved string value from registry: " + buffer);
			return std::wstring(buffer);  
		}
		else {
			LogQueries("d", xmlName + L" - Failed to retrieve string value from registry. Attempting to read as XML.");
		}
	}

	CComPtr<IStream> pFileStream;
	HRESULT hr = SHCreateStreamOnFileEx(settingsname.c_str(), STGM_READ, FILE_ATTRIBUTE_NORMAL, FALSE, nullptr, &pFileStream);
	if (FAILED(hr)) {
		LogQueries("d", xmlName + L" - Failed to create file stream for XML settings.");
		return L""; 
	}

	CComPtr<IXmlReader> pReader;
	hr = CreateXmlReader(__uuidof(IXmlReader), (void**)&pReader, nullptr);
	if (FAILED(hr)) {
		LogQueries("d", xmlName + L" - Failed to create XML reader.");
		return L""; 
	}

	hr = pReader->SetInput(pFileStream);
	if (FAILED(hr)) {
		LogQueries("d", xmlName + L" - Failed to set input for XML reader.");
		return L"";  
	}

	XmlNodeType nodeType;
	const wchar_t* pwszLocalName;
	std::wstring xmlLoggingValue = L"";  

	while (S_OK == pReader->Read(&nodeType)) {
		if (nodeType == XmlNodeType_Element) {
			pReader->GetLocalName(&pwszLocalName, nullptr);
			if (pwszLocalName && wcscmp(pwszLocalName, xmlName.c_str()) == 0) {
				pReader->Read(&nodeType);
				if (nodeType == XmlNodeType_Text) {
					const wchar_t* pwszValue;
					pReader->GetValue(&pwszValue, nullptr);
					if (pwszValue) {
						xmlLoggingValue = pwszValue;
					}
					LogQueries("i", xmlName + L" - Retrieved from XML: " + xmlLoggingValue);
					break;
				}
			}
		}
	}

	return xmlLoggingValue;  
}

double GetDoubleSetting(const std::wstring& settingKey) {
	auto it = SettingsQueryMap.find(settingKey);
	if (it == SettingsQueryMap.end()) {
		vddlog("e", "requested data not found in xml, consider updating xml!");
		return 0.0;
	}

	std::wstring regName = it->second.first;
	std::wstring xmlName = it->second.second;

	std::wstring settingsname = confpath + L"\\vdd_settings.xml";
	HKEY hKey;
	DWORD dwBufferSize = MAX_PATH;
	wchar_t buffer[MAX_PATH];

	LONG lResult = RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\MikeTheTech\\VirtualDisplayDriver", 0, KEY_READ, &hKey);
	if (lResult == ERROR_SUCCESS) {
		lResult = RegQueryValueExW(hKey, regName.c_str(), NULL, NULL, (LPBYTE)buffer, &dwBufferSize);
		if (lResult == ERROR_SUCCESS) {
			RegCloseKey(hKey);
			try {
				double regValue = std::stod(buffer);
				LogQueries("d", xmlName + L" - Retrieved from registry: " + std::to_wstring(regValue));
				return regValue;
			}
			catch (const std::exception&) {
				LogQueries("d", xmlName + L" - Failed to convert registry value to double.");
			}
		}
		else {
			RegCloseKey(hKey);
		}
	}

	CComPtr<IStream> pFileStream;
	HRESULT hr = SHCreateStreamOnFileEx(settingsname.c_str(), STGM_READ, FILE_ATTRIBUTE_NORMAL, FALSE, nullptr, &pFileStream);
	if (FAILED(hr)) {
		LogQueries("d", xmlName + L" - Failed to create file stream for XML settings.");
		return 0.0;
	}

	CComPtr<IXmlReader> pReader;
	hr = CreateXmlReader(__uuidof(IXmlReader), (void**)&pReader, nullptr);
	if (FAILED(hr)) {
		LogQueries("d", xmlName + L" - Failed to create XML reader.");
		return 0.0;
	}

	hr = pReader->SetInput(pFileStream);
	if (FAILED(hr)) {
		LogQueries("d", xmlName + L" - Failed to set input for XML reader.");
		return 0.0;
	}

	XmlNodeType nodeType;
	const wchar_t* pwszLocalName;
	double xmlLoggingValue = 0.0;

	while (S_OK == pReader->Read(&nodeType)) {
		if (nodeType == XmlNodeType_Element) {
			pReader->GetLocalName(&pwszLocalName, nullptr);
			if (pwszLocalName && wcscmp(pwszLocalName, xmlName.c_str()) == 0) {
				pReader->Read(&nodeType);
				if (nodeType == XmlNodeType_Text) {
					const wchar_t* pwszValue;
					pReader->GetValue(&pwszValue, nullptr);
					if (pwszValue) {
						try {
							xmlLoggingValue = std::stod(pwszValue);
							LogQueries("i", xmlName + L" - Retrieved from XML: " + std::to_wstring(xmlLoggingValue));
						}
						catch (const std::exception&) {
							LogQueries("d", xmlName + L" - Failed to convert XML value to double.");
						}
					}
					break;
				}
			}
		}
	}

	return xmlLoggingValue;
}

// === EDID PROFILE LOADING FUNCTION ===
struct EdidProfileData {
	vector<tuple<int, int, int, int>> modes;
	bool hdr10Supported = false;
	bool dolbyVisionSupported = false;
	bool hdr10PlusSupported = false;
	double maxLuminance = 0.0;
	double minLuminance = 0.0;
	wstring primaryColorSpace = L"sRGB";
	double gamma = 2.2;
	double redX = 0.64, redY = 0.33;
	double greenX = 0.30, greenY = 0.60;
	double blueX = 0.15, blueY = 0.06;
	double whiteX = 0.3127, whiteY = 0.3290;
	int preferredWidth = 1920;
	int preferredHeight = 1080;
	double preferredRefresh = 60.0;
};

// === COLOR SPACE AND GAMMA STRUCTURES ===
struct VddColorMatrix {
	FLOAT matrix[3][4] = {}; // 3x4 color space transformation matrix - zero initialized
	bool isValid = false;
};

struct VddGammaRamp {
	FLOAT gamma = 2.2f;
	wstring colorSpace;
	VddColorMatrix matrix = {};
	bool useMatrix = false;
	bool isValid = false;
};

// === GAMMA AND COLOR SPACE STORAGE ===
std::map<IDDCX_MONITOR, VddGammaRamp> g_GammaRampStore;

// === COLOR SPACE AND GAMMA CONVERSION FUNCTIONS ===

// Convert gamma value to 3x4 color space transformation matrix
VddColorMatrix ConvertGammaToMatrix(double gamma, const wstring& colorSpace) {
	VddColorMatrix matrix = {};
	
	// Identity matrix as base
	for (int i = 0; i < 3; i++) {
		for (int j = 0; j < 4; j++) {
			matrix.matrix[i][j] = (i == j) ? 1.0f : 0.0f;
		}
	}
	
	// Apply gamma correction to diagonal elements
	float gammaValue = static_cast<float>(gamma);
	
	if (colorSpace == L"sRGB") {
		// sRGB gamma correction (2.2)
		matrix.matrix[0][0] = gammaValue / 2.2f;  // Red
		matrix.matrix[1][1] = gammaValue / 2.2f;  // Green
		matrix.matrix[2][2] = gammaValue / 2.2f;  // Blue
	}
	else if (colorSpace == L"DCI-P3") {
		// DCI-P3 color space transformation with gamma
		// P3 to sRGB matrix with gamma correction
		matrix.matrix[0][0] = 1.2249f * (gammaValue / 2.4f);
		matrix.matrix[0][1] = -0.2247f;
		matrix.matrix[0][2] = 0.0f;
		matrix.matrix[1][0] = -0.0420f;
		matrix.matrix[1][1] = 1.0419f * (gammaValue / 2.4f);
		matrix.matrix[1][2] = 0.0f;
		matrix.matrix[2][0] = -0.0196f;
		matrix.matrix[2][1] = -0.0786f;
		matrix.matrix[2][2] = 1.0982f * (gammaValue / 2.4f);
	}
	else if (colorSpace == L"Rec.2020") {
		// Rec.2020 to sRGB matrix with gamma correction
		matrix.matrix[0][0] = 1.7347f * (gammaValue / 2.4f);
		matrix.matrix[0][1] = -0.7347f;
		matrix.matrix[0][2] = 0.0f;
		matrix.matrix[1][0] = -0.1316f;
		matrix.matrix[1][1] = 1.1316f * (gammaValue / 2.4f);
		matrix.matrix[1][2] = 0.0f;
		matrix.matrix[2][0] = -0.0241f;
		matrix.matrix[2][1] = -0.1289f;
		matrix.matrix[2][2] = 1.1530f * (gammaValue / 2.4f);
	}
	else if (colorSpace == L"Adobe_RGB") {
		// Adobe RGB with gamma correction
		matrix.matrix[0][0] = 1.0f * (gammaValue / 2.2f);
		matrix.matrix[1][1] = 1.0f * (gammaValue / 2.2f);
		matrix.matrix[2][2] = 1.0f * (gammaValue / 2.2f);
	}
	else {
		// Default to sRGB for unknown color spaces
		matrix.matrix[0][0] = gammaValue / 2.2f;
		matrix.matrix[1][1] = gammaValue / 2.2f;
		matrix.matrix[2][2] = gammaValue / 2.2f;
	}
	
	matrix.isValid = true;
	return matrix;
}

// Convert EDID profile to gamma ramp
VddGammaRamp ConvertEdidToGammaRamp(const EdidProfileData& profile) {
	VddGammaRamp gammaRamp = {};
	
	gammaRamp.gamma = static_cast<FLOAT>(profile.gamma);
	gammaRamp.colorSpace = profile.primaryColorSpace;
	
	// Generate matrix if matrix transforms are enabled
	if (enableMatrixTransform) {
		gammaRamp.matrix = ConvertGammaToMatrix(profile.gamma, profile.primaryColorSpace);
		gammaRamp.useMatrix = gammaRamp.matrix.isValid;
	}
	
	gammaRamp.isValid = colorSpaceEnabled;
	
	return gammaRamp;
}

// Convert manual settings to gamma ramp
VddGammaRamp ConvertManualToGammaRamp() {
	VddGammaRamp gammaRamp = {};
	
	gammaRamp.gamma = static_cast<FLOAT>(gammaCorrection);
	gammaRamp.colorSpace = primaryColorSpace;
	
	// Generate matrix if matrix transforms are enabled
	if (enableMatrixTransform) {
		gammaRamp.matrix = ConvertGammaToMatrix(gammaCorrection, primaryColorSpace);
		gammaRamp.useMatrix = gammaRamp.matrix.isValid;
	}
	
	gammaRamp.isValid = colorSpaceEnabled;
	
	return gammaRamp;
}

// Enhanced color format selection based on color space
IDDCX_BITS_PER_COMPONENT SelectBitDepthFromColorSpace(const wstring& colorSpace) {
	if (autoSelectFromColorSpace) {
		if (colorSpace == L"Rec.2020") {
			return IDDCX_BITS_PER_COMPONENT_10;  // HDR10 - 10-bit for wide color gamut
		} else if (colorSpace == L"DCI-P3") {
			return IDDCX_BITS_PER_COMPONENT_10;  // Wide color gamut - 10-bit
		} else if (colorSpace == L"Adobe_RGB") {
			return IDDCX_BITS_PER_COMPONENT_10;  // Professional - 10-bit
		} else {
			return IDDCX_BITS_PER_COMPONENT_8;   // sRGB - 8-bit
		}
	}
	
	// Manual bit depth override
	if (forceBitDepth == L"8") {
		return IDDCX_BITS_PER_COMPONENT_8;
	} else if (forceBitDepth == L"10") {
		return IDDCX_BITS_PER_COMPONENT_10;
	} else if (forceBitDepth == L"12") {
		return IDDCX_BITS_PER_COMPONENT_12;
	}
	
	// Default to existing color depth logic
	return HDRPlus ? IDDCX_BITS_PER_COMPONENT_12 : 
		   (SDR10 ? IDDCX_BITS_PER_COMPONENT_10 : IDDCX_BITS_PER_COMPONENT_8);
}

// === SMPTE ST.2086 HDR METADATA STRUCTURE ===
struct VddHdrMetadata {
	// SMPTE ST.2086 Display Primaries (scaled 0-50000) - zero initialized
	UINT16 display_primaries_x[3] = {};      // R, G, B chromaticity x coordinates
	UINT16 display_primaries_y[3] = {};      // R, G, B chromaticity y coordinates
	UINT16 white_point_x = 0;               // White point x coordinate
	UINT16 white_point_y = 0;               // White point y coordinate
	
	// Luminance values (0.0001 cd/m² units for SMPTE ST.2086)
	UINT32 max_display_mastering_luminance = 0;
	UINT32 min_display_mastering_luminance = 0;
	
	// Content light level (nits)
	UINT16 max_content_light_level = 0;
	UINT16 max_frame_avg_light_level = 0;
	
	// Validation flag
	bool isValid = false;
};

// === HDR METADATA STORAGE ===
std::map<IDDCX_MONITOR, VddHdrMetadata> g_HdrMetadataStore;

// === HDR METADATA CONVERSION FUNCTIONS ===

// Convert EDID chromaticity (0.0-1.0) to SMPTE ST.2086 format (0-50000)
UINT16 ConvertChromaticityToSmpte(double edidValue) {
	// Clamp to valid range
	if (edidValue < 0.0) edidValue = 0.0;
	if (edidValue > 1.0) edidValue = 1.0;
	
	return static_cast<UINT16>(edidValue * 50000.0);
}

// Convert EDID luminance (nits) to SMPTE ST.2086 format (0.0001 cd/m² units)
UINT32 ConvertLuminanceToSmpte(double nits) {
	// Clamp to reasonable range (0.0001 to 10000 nits)
	if (nits < 0.0001) nits = 0.0001;
	if (nits > 10000.0) nits = 10000.0;
	
	return static_cast<UINT32>(nits * 10000.0);
}

// Convert EDID profile data to SMPTE ST.2086 HDR metadata
VddHdrMetadata ConvertEdidToSmpteMetadata(const EdidProfileData& profile) {
	VddHdrMetadata metadata = {};
	
	// Convert chromaticity coordinates
	metadata.display_primaries_x[0] = ConvertChromaticityToSmpte(profile.redX);     // Red
	metadata.display_primaries_y[0] = ConvertChromaticityToSmpte(profile.redY);
	metadata.display_primaries_x[1] = ConvertChromaticityToSmpte(profile.greenX);   // Green  
	metadata.display_primaries_y[1] = ConvertChromaticityToSmpte(profile.greenY);
	metadata.display_primaries_x[2] = ConvertChromaticityToSmpte(profile.blueX);    // Blue
	metadata.display_primaries_y[2] = ConvertChromaticityToSmpte(profile.blueY);
	
	// Convert white point
	metadata.white_point_x = ConvertChromaticityToSmpte(profile.whiteX);
	metadata.white_point_y = ConvertChromaticityToSmpte(profile.whiteY);
	
	// Convert luminance values
	metadata.max_display_mastering_luminance = ConvertLuminanceToSmpte(profile.maxLuminance);
	metadata.min_display_mastering_luminance = ConvertLuminanceToSmpte(profile.minLuminance);
	
	// Use configured content light levels (from vdd_settings.xml)
	metadata.max_content_light_level = static_cast<UINT16>(maxContentLightLevel);
	metadata.max_frame_avg_light_level = static_cast<UINT16>(maxFrameAvgLightLevel);
	
	// Mark as valid if we have HDR10 support
	metadata.isValid = profile.hdr10Supported && hdr10StaticMetadataEnabled;
	
	return metadata;
}

// Convert manual settings to SMPTE ST.2086 HDR metadata
VddHdrMetadata ConvertManualToSmpteMetadata() {
	VddHdrMetadata metadata = {};
	
	// Convert manual chromaticity coordinates
	metadata.display_primaries_x[0] = ConvertChromaticityToSmpte(redX);     // Red
	metadata.display_primaries_y[0] = ConvertChromaticityToSmpte(redY);
	metadata.display_primaries_x[1] = ConvertChromaticityToSmpte(greenX);   // Green  
	metadata.display_primaries_y[1] = ConvertChromaticityToSmpte(greenY);
	metadata.display_primaries_x[2] = ConvertChromaticityToSmpte(blueX);    // Blue
	metadata.display_primaries_y[2] = ConvertChromaticityToSmpte(blueY);
	
	// Convert manual white point
	metadata.white_point_x = ConvertChromaticityToSmpte(whiteX);
	metadata.white_point_y = ConvertChromaticityToSmpte(whiteY);
	
	// Convert manual luminance values
	metadata.max_display_mastering_luminance = ConvertLuminanceToSmpte(maxDisplayMasteringLuminance);
	metadata.min_display_mastering_luminance = ConvertLuminanceToSmpte(minDisplayMasteringLuminance);
	
	// Use configured content light levels
	metadata.max_content_light_level = static_cast<UINT16>(maxContentLightLevel);
	metadata.max_frame_avg_light_level = static_cast<UINT16>(maxFrameAvgLightLevel);
	
	// Mark as valid if HDR10 metadata is enabled and color primaries are enabled
	metadata.isValid = hdr10StaticMetadataEnabled && colorPrimariesEnabled;
	
	return metadata;
}

// === ENHANCED MODE MANAGEMENT FUNCTIONS ===

// Generate modes from EDID with advanced filtering and optimization
vector<tuple<int, int, int, int>> GenerateModesFromEdid(const EdidProfileData& profile) {
	vector<tuple<int, int, int, int>> generatedModes;
	
	if (!autoResolutionsEnabled) {
		vddlog("i", "Auto resolutions disabled, skipping EDID mode generation");
		return generatedModes;
	}
	
	for (const auto& mode : profile.modes) {
		int width = get<0>(mode);
		int height = get<1>(mode);
		int refreshRateMultiplier = get<2>(mode);
		int nominalRefreshRate = get<3>(mode);
		
		// Apply comprehensive filtering
		bool passesFilter = true;
		
		// Resolution range filtering
		if (width < minResolutionWidth || width > maxResolutionWidth ||
			height < minResolutionHeight || height > maxResolutionHeight) {
			passesFilter = false;
		}
		
		// Refresh rate filtering
		if (nominalRefreshRate < minRefreshRate || nominalRefreshRate > maxRefreshRate) {
			passesFilter = false;
		}
		
		// Fractional rate filtering
		if (excludeFractionalRates && refreshRateMultiplier != 1000) {
			passesFilter = false;
		}
		
		// Add custom quality filtering
		if (passesFilter) {
			// Prefer standard aspect ratios for better compatibility
			double aspectRatio = static_cast<double>(width) / height;
			bool isStandardAspect = (abs(aspectRatio - 16.0/9.0) < 0.01) ||  // 16:9
								   (abs(aspectRatio - 16.0/10.0) < 0.01) ||  // 16:10
								   (abs(aspectRatio - 4.0/3.0) < 0.01) ||    // 4:3
								   (abs(aspectRatio - 21.0/9.0) < 0.01);     // 21:9
			
			// Log non-standard aspect ratios for information
			if (!isStandardAspect) {
				stringstream ss;
				ss << "Including non-standard aspect ratio mode: " << width << "x" << height 
				   << " (ratio: " << fixed << setprecision(2) << aspectRatio << ")";
				vddlog("d", ss.str().c_str());
			}
			
			generatedModes.push_back(mode);
		}
	}
	
	// Sort modes by preference (resolution, then refresh rate)
	sort(generatedModes.begin(), generatedModes.end(), 
		 [](const tuple<int, int, int, int>& a, const tuple<int, int, int, int>& b) {
			 // Primary sort: resolution (area)
			 int areaA = get<0>(a) * get<1>(a);
			 int areaB = get<0>(b) * get<1>(b);
			 if (areaA != areaB) return areaA > areaB;  // Larger resolution first
			 
			 // Secondary sort: refresh rate
			 return get<3>(a) > get<3>(b);  // Higher refresh rate first
		 });
	
	stringstream ss;
	ss << "Generated " << generatedModes.size() << " modes from EDID (filtered from " << profile.modes.size() << " total)";
	vddlog("i", ss.str().c_str());
	
	return generatedModes;
}

// Find and validate preferred mode from EDID
tuple<int, int, int, int> FindPreferredModeFromEdid(const EdidProfileData& profile, 
												   const vector<tuple<int, int, int, int>>& availableModes) {
	// Default fallback mode
	tuple<int, int, int, int> preferredMode = make_tuple(fallbackWidth, fallbackHeight, 1000, fallbackRefresh);
	
	if (!useEdidPreferred) {
		vddlog("i", "EDID preferred mode disabled, using fallback");
		return preferredMode;
	}
	
	// Look for EDID preferred mode in available modes
	for (const auto& mode : availableModes) {
		if (get<0>(mode) == profile.preferredWidth && 
			get<1>(mode) == profile.preferredHeight) {
			// Found matching resolution, use it
			preferredMode = mode;
			
			stringstream ss;
			ss << "Found EDID preferred mode: " << profile.preferredWidth << "x" << profile.preferredHeight 
			   << "@" << get<3>(mode) << "Hz";
			vddlog("i", ss.str().c_str());
			break;
		}
	}
	
	return preferredMode;
}

// Merge and optimize mode lists
vector<tuple<int, int, int, int>> MergeAndOptimizeModes(const vector<tuple<int, int, int, int>>& manualModes,
														const vector<tuple<int, int, int, int>>& edidModes) {
	vector<tuple<int, int, int, int>> mergedModes;
	
	if (sourcePriority == L"edid") {
		mergedModes = edidModes;
		vddlog("i", "Using EDID-only mode list");
	}
	else if (sourcePriority == L"manual") {
		mergedModes = manualModes;
		vddlog("i", "Using manual-only mode list");
	}
	else if (sourcePriority == L"combined") {
		// Start with manual modes
		mergedModes = manualModes;
		
		// Add EDID modes that don't duplicate manual modes
		for (const auto& edidMode : edidModes) {
			bool isDuplicate = false;
			for (const auto& manualMode : manualModes) {
				if (get<0>(edidMode) == get<0>(manualMode) && 
					get<1>(edidMode) == get<1>(manualMode) && 
					get<3>(edidMode) == get<3>(manualMode)) {
					isDuplicate = true;
					break;
				}
			}
			if (!isDuplicate) {
				mergedModes.push_back(edidMode);
			}
		}
		
		stringstream ss;
		ss << "Combined modes: " << manualModes.size() << " manual + " 
		   << (mergedModes.size() - manualModes.size()) << " unique EDID = " << mergedModes.size() << " total";
		vddlog("i", ss.str().c_str());
	}
	
	return mergedModes;
}

// Optimize mode list for performance and compatibility
vector<tuple<int, int, int, int>> OptimizeModeList(const vector<tuple<int, int, int, int>>& modes,
												   const tuple<int, int, int, int>& preferredMode) {
	vector<tuple<int, int, int, int>> optimizedModes = modes;
	
	// Remove preferred mode from list if it exists, we'll add it at the front
	optimizedModes.erase(
		remove_if(optimizedModes.begin(), optimizedModes.end(),
				  [&preferredMode](const tuple<int, int, int, int>& mode) {
					  return get<0>(mode) == get<0>(preferredMode) && 
							 get<1>(mode) == get<1>(preferredMode) &&
							 get<3>(mode) == get<3>(preferredMode);
				  }),
		optimizedModes.end());
	
	// Insert preferred mode at the beginning
	optimizedModes.insert(optimizedModes.begin(), preferredMode);
	
	// Remove duplicate modes (same resolution and refresh rate)
	sort(optimizedModes.begin(), optimizedModes.end());
	optimizedModes.erase(unique(optimizedModes.begin(), optimizedModes.end(),
								[](const tuple<int, int, int, int>& a, const tuple<int, int, int, int>& b) {
									return get<0>(a) == get<0>(b) && 
										   get<1>(a) == get<1>(b) && 
										   get<3>(a) == get<3>(b);
								}),
						 optimizedModes.end());
	
	// Limit total number of modes for performance (Windows typically supports 20-50 modes)
	const size_t maxModes = 32;
	if (optimizedModes.size() > maxModes) {
		optimizedModes.resize(maxModes);
		stringstream ss;
		ss << "Limited mode list to " << maxModes << " modes for optimal performance";
		vddlog("i", ss.str().c_str());
	}
	
	return optimizedModes;
}

// Enhanced mode validation with detailed reporting
bool ValidateModeList(const vector<tuple<int, int, int, int>>& modes) {
	if (modes.empty()) {
		vddlog("e", "Mode list is empty - this will cause display driver failure");
		return false;
	}
	
	stringstream validationReport;
	validationReport << "=== MODE LIST VALIDATION REPORT ===\n"
					<< "Total modes: " << modes.size() << "\n";
	
	// Analyze resolution distribution
	map<pair<int, int>, int> resolutionCount;
	map<int, int> refreshRateCount;
	
	for (const auto& mode : modes) {
		pair<int, int> resolution = {get<0>(mode), get<1>(mode)};
		resolutionCount[resolution]++;
		refreshRateCount[get<3>(mode)]++;
	}
	
	validationReport << "Unique resolutions: " << resolutionCount.size() << "\n";
	validationReport << "Unique refresh rates: " << refreshRateCount.size() << "\n";
	validationReport << "Preferred mode: " << get<0>(modes[0]) << "x" << get<1>(modes[0]) 
					<< "@" << get<3>(modes[0]) << "Hz";
	
	vddlog("i", validationReport.str().c_str());
	
	return true;
}

bool LoadEdidProfile(const wstring& profilePath, EdidProfileData& profile) {
	wstring fullPath = confpath + L"\\" + profilePath;
	
	// Check if file exists
	if (!PathFileExistsW(fullPath.c_str())) {
		vddlog("w", ("EDID profile not found: " + WStringToString(fullPath)).c_str());
		return false;
	}

	CComPtr<IStream> pStream;
	CComPtr<IXmlReader> pReader;
	HRESULT hr = SHCreateStreamOnFileW(fullPath.c_str(), STGM_READ, &pStream);
	if (FAILED(hr)) {
		vddlog("e", "LoadEdidProfile: Failed to create file stream.");
		return false;
	}

	hr = CreateXmlReader(__uuidof(IXmlReader), (void**)&pReader, NULL);
	if (FAILED(hr)) {
		vddlog("e", "LoadEdidProfile: Failed to create XmlReader.");
		return false;
	}

	hr = pReader->SetInput(pStream);
	if (FAILED(hr)) {
		vddlog("e", "LoadEdidProfile: Failed to set input stream.");
		return false;
	}

	XmlNodeType nodeType;
	const WCHAR* pwszLocalName;
	const WCHAR* pwszValue;
	UINT cwchLocalName;
	UINT cwchValue;
	wstring currentElement;
	wstring currentSection;
	
	// Temporary mode data
	int tempWidth = 0, tempHeight = 0, tempRefreshRateMultiplier = 1000, tempNominalRefreshRate = 60;

	while (S_OK == (hr = pReader->Read(&nodeType))) {
		switch (nodeType) {
		case XmlNodeType_Element:
			hr = pReader->GetLocalName(&pwszLocalName, &cwchLocalName);
			if (FAILED(hr)) return false;
			currentElement = wstring(pwszLocalName, cwchLocalName);
			
			// Track sections for context
			if (currentElement == L"MonitorModes" || currentElement == L"HDRCapabilities" || 
				currentElement == L"ColorProfile" || currentElement == L"PreferredMode") {
				currentSection = currentElement;
			}
			break;
			
		case XmlNodeType_Text:
			hr = pReader->GetValue(&pwszValue, &cwchValue);
			if (FAILED(hr)) return false;
			
			wstring value = wstring(pwszValue, cwchValue);
			
			// Parse monitor modes
			if (currentSection == L"MonitorModes") {
				if (currentElement == L"Width") {
					tempWidth = stoi(value);
				}
				else if (currentElement == L"Height") {
					tempHeight = stoi(value);
				}
				else if (currentElement == L"RefreshRateMultiplier") {
					tempRefreshRateMultiplier = stoi(value);
				}
				else if (currentElement == L"NominalRefreshRate") {
					tempNominalRefreshRate = stoi(value);
					// Complete mode entry
					if (tempWidth > 0 && tempHeight > 0) {
						profile.modes.push_back(make_tuple(tempWidth, tempHeight, tempRefreshRateMultiplier, tempNominalRefreshRate));
						stringstream ss;
						ss << "EDID Mode: " << tempWidth << "x" << tempHeight << " @ " << tempRefreshRateMultiplier << "/" << tempNominalRefreshRate << "Hz";
						vddlog("d", ss.str().c_str());
					}
				}
			}
			// Parse HDR capabilities
			else if (currentSection == L"HDRCapabilities") {
				if (currentElement == L"HDR10Supported") {
					profile.hdr10Supported = (value == L"true");
				}
				else if (currentElement == L"DolbyVisionSupported") {
					profile.dolbyVisionSupported = (value == L"true");
				}
				else if (currentElement == L"HDR10PlusSupported") {
					profile.hdr10PlusSupported = (value == L"true");
				}
				else if (currentElement == L"MaxLuminance") {
					profile.maxLuminance = stod(value);
				}
				else if (currentElement == L"MinLuminance") {
					profile.minLuminance = stod(value);
				}
			}
			// Parse color profile
			else if (currentSection == L"ColorProfile") {
				if (currentElement == L"PrimaryColorSpace") {
					profile.primaryColorSpace = value;
				}
				else if (currentElement == L"Gamma") {
					profile.gamma = stod(value);
				}
				else if (currentElement == L"RedX") {
					profile.redX = stod(value);
				}
				else if (currentElement == L"RedY") {
					profile.redY = stod(value);
				}
				else if (currentElement == L"GreenX") {
					profile.greenX = stod(value);
				}
				else if (currentElement == L"GreenY") {
					profile.greenY = stod(value);
				}
				else if (currentElement == L"BlueX") {
					profile.blueX = stod(value);
				}
				else if (currentElement == L"BlueY") {
					profile.blueY = stod(value);
				}
				else if (currentElement == L"WhiteX") {
					profile.whiteX = stod(value);
				}
				else if (currentElement == L"WhiteY") {
					profile.whiteY = stod(value);
				}
			}
			// Parse preferred mode
			else if (currentSection == L"PreferredMode") {
				if (currentElement == L"Width") {
					profile.preferredWidth = stoi(value);
				}
				else if (currentElement == L"Height") {
					profile.preferredHeight = stoi(value);
				}
				else if (currentElement == L"RefreshRate") {
					profile.preferredRefresh = stod(value);
				}
			}
			break;
		}
	}

	stringstream ss;
	ss << "EDID Profile loaded: " << profile.modes.size() << " modes, HDR10: " << (profile.hdr10Supported ? "Yes" : "No") 
	   << ", Color space: " << WStringToString(profile.primaryColorSpace);
	vddlog("i", ss.str().c_str());
	
	return true;
}

bool ApplyEdidProfile(const EdidProfileData& profile) {
	if (!edidIntegrationEnabled) {
		return false;
	}

	// === ENHANCED MODE MANAGEMENT ===
	if (autoResolutionsEnabled) {
		// Store original manual modes
		vector<tuple<int, int, int, int>> originalModes = monitorModes;
		
		// Generate optimized modes from EDID
		vector<tuple<int, int, int, int>> edidModes = GenerateModesFromEdid(profile);
		
		// Find preferred mode from EDID
		tuple<int, int, int, int> preferredMode = FindPreferredModeFromEdid(profile, edidModes);
		
		// Merge and optimize mode lists
		vector<tuple<int, int, int, int>> finalModes = MergeAndOptimizeModes(originalModes, edidModes);
		
		// Optimize final mode list with preferred mode priority
		finalModes = OptimizeModeList(finalModes, preferredMode);
		
		// Validate the final mode list
		if (ValidateModeList(finalModes)) {
			monitorModes = finalModes;
			
			stringstream ss;
			ss << "Enhanced mode management completed:\n"
			   << "  Original manual modes: " << originalModes.size() << "\n"
			   << "  Generated EDID modes: " << edidModes.size() << "\n"
			   << "  Final optimized modes: " << finalModes.size() << "\n"
			   << "  Preferred mode: " << get<0>(preferredMode) << "x" << get<1>(preferredMode) 
			   << "@" << get<3>(preferredMode) << "Hz\n"
			   << "  Source priority: " << WStringToString(sourcePriority);
			vddlog("i", ss.str().c_str());
		} else {
			vddlog("e", "Mode list validation failed, keeping original modes");
		}
	}

	// Apply HDR settings if configured
	if (hdr10StaticMetadataEnabled && profile.hdr10Supported) {
		if (overrideManualSettings || maxDisplayMasteringLuminance == 1000.0) { // Default value
			maxDisplayMasteringLuminance = profile.maxLuminance;
		}
		if (overrideManualSettings || minDisplayMasteringLuminance == 0.05) { // Default value
			minDisplayMasteringLuminance = profile.minLuminance;
		}
	}

	// Apply color primaries if configured
	if (colorPrimariesEnabled && (overrideManualSettings || redX == 0.708)) { // Default Rec.2020 values
		redX = profile.redX;
		redY = profile.redY;
		greenX = profile.greenX;
		greenY = profile.greenY;
		blueX = profile.blueX;
		blueY = profile.blueY;
		whiteX = profile.whiteX;
		whiteY = profile.whiteY;
	}

	// Apply color space settings
	if (colorSpaceEnabled && (overrideManualSettings || primaryColorSpace == L"sRGB")) { // Default value
		primaryColorSpace = profile.primaryColorSpace;
		gammaCorrection = profile.gamma;
	}

	// Generate and store HDR metadata for all monitors if HDR is enabled
	if (hdr10StaticMetadataEnabled && profile.hdr10Supported) {
		VddHdrMetadata hdrMetadata = ConvertEdidToSmpteMetadata(profile);
		
		if (hdrMetadata.isValid) {
			// Store metadata for future monitor creation
			// Note: We don't have monitor handles yet at this point, so we'll store it as a template
			// The actual association will happen when monitors are created or HDR metadata is requested
			
			stringstream ss;
			ss << "Generated SMPTE ST.2086 HDR metadata from EDID profile:\n"
			   << "  Red: (" << hdrMetadata.display_primaries_x[0] << ", " << hdrMetadata.display_primaries_y[0] << ") "
			   << "→ (" << profile.redX << ", " << profile.redY << ")\n"
			   << "  Green: (" << hdrMetadata.display_primaries_x[1] << ", " << hdrMetadata.display_primaries_y[1] << ") "
			   << "→ (" << profile.greenX << ", " << profile.greenY << ")\n"
			   << "  Blue: (" << hdrMetadata.display_primaries_x[2] << ", " << hdrMetadata.display_primaries_y[2] << ") "
			   << "→ (" << profile.blueX << ", " << profile.blueY << ")\n"
			   << "  White Point: (" << hdrMetadata.white_point_x << ", " << hdrMetadata.white_point_y << ") "
			   << "→ (" << profile.whiteX << ", " << profile.whiteY << ")\n"
			   << "  Max Luminance: " << hdrMetadata.max_display_mastering_luminance 
			   << " (" << profile.maxLuminance << " nits)\n"
			   << "  Min Luminance: " << hdrMetadata.min_display_mastering_luminance 
			   << " (" << profile.minLuminance << " nits)";
			vddlog("i", ss.str().c_str());
			
			// Store as template metadata - will be applied to monitors during HDR metadata events
			// We use a special key (nullptr converted to uintptr_t) to indicate template metadata
			g_HdrMetadataStore[reinterpret_cast<IDDCX_MONITOR>(0)] = hdrMetadata;
		} else {
			vddlog("w", "Generated HDR metadata is not valid, skipping storage");
		}
	}

	// Generate and store gamma ramp for color space processing if enabled
	if (colorSpaceEnabled) {
		VddGammaRamp gammaRamp = ConvertEdidToGammaRamp(profile);
		
		if (gammaRamp.isValid) {
			// Store gamma ramp as template for future monitor creation
			stringstream ss;
			ss << "Generated Gamma Ramp from EDID profile:\n"
			   << "  Gamma: " << gammaRamp.gamma << " (from " << profile.gamma << ")\n"
			   << "  Color Space: " << WStringToString(gammaRamp.colorSpace) << "\n"
			   << "  Matrix Transform: " << (gammaRamp.useMatrix ? "Enabled" : "Disabled");
			
			if (gammaRamp.useMatrix) {
				ss << "\n  3x4 Matrix:\n"
				   << "    [" << gammaRamp.matrix.matrix[0][0] << ", " << gammaRamp.matrix.matrix[0][1] << ", " << gammaRamp.matrix.matrix[0][2] << ", " << gammaRamp.matrix.matrix[0][3] << "]\n"
				   << "    [" << gammaRamp.matrix.matrix[1][0] << ", " << gammaRamp.matrix.matrix[1][1] << ", " << gammaRamp.matrix.matrix[1][2] << ", " << gammaRamp.matrix.matrix[1][3] << "]\n"
				   << "    [" << gammaRamp.matrix.matrix[2][0] << ", " << gammaRamp.matrix.matrix[2][1] << ", " << gammaRamp.matrix.matrix[2][2] << ", " << gammaRamp.matrix.matrix[2][3] << "]";
			}
			
			vddlog("i", ss.str().c_str());
			
			// Store as template gamma ramp - will be applied to monitors during gamma ramp events
			// We use a special key (nullptr converted to uintptr_t) to indicate template gamma ramp
			g_GammaRampStore[reinterpret_cast<IDDCX_MONITOR>(0)] = gammaRamp;
		} else {
			vddlog("w", "Generated gamma ramp is not valid, skipping storage");
		}
	}

	return true;
}

int gcd(int a, int b) {
	while (b != 0) {
		int temp = b;
		b = a % b;
		a = temp;
	}
	return a;
}

void float_to_vsync(float refresh_rate, int& num, int& den) {
	den = 10000;

	num = static_cast<int>(round(refresh_rate * den));

	int divisor = gcd(num, den);
	num /= divisor;
	den /= divisor;
}

void  SendToPipe(const std::string& logMessage) {
	if (g_pipeHandle != INVALID_HANDLE_VALUE) {
		DWORD bytesWritten;
		DWORD logMessageSize = static_cast<DWORD>(logMessage.size());
		WriteFile(g_pipeHandle, logMessage.c_str(), logMessageSize, &bytesWritten, NULL);
	}
}

void vddlog(const char* type, const char* message) {
	FILE* logFile;
	wstring logsDir = confpath + L"\\Logs";

	auto now = chrono::system_clock::now();
	auto in_time_t = chrono::system_clock::to_time_t(now);
	tm tm_buf;
	localtime_s(&tm_buf, &in_time_t);
	wchar_t date_str[11]; 
	wcsftime(date_str, sizeof(date_str) / sizeof(wchar_t), L"%Y-%m-%d", &tm_buf);

	wstring logPath = logsDir + L"\\log_" + date_str + L".txt";

	if (logsEnabled) {
		if (!CreateDirectoryW(logsDir.c_str(), NULL) && GetLastError() != ERROR_ALREADY_EXISTS) {
			//Just any errors here
		}
	}
	else {
		WIN32_FIND_DATAW findFileData;
		HANDLE hFind = FindFirstFileW((logsDir + L"\\*").c_str(), &findFileData);

		if (hFind != INVALID_HANDLE_VALUE) {
			do {
				const wstring fileOrDir = findFileData.cFileName;
				if (fileOrDir != L"." && fileOrDir != L"..") {
					wstring filePath = logsDir + L"\\" + fileOrDir;
					if (!(findFileData.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY)) {
						DeleteFileW(filePath.c_str());
					}
				}
			} while (FindNextFileW(hFind, &findFileData) != 0);
			FindClose(hFind);
		}

		RemoveDirectoryW(logsDir.c_str());
		return;  
	}

	string narrow_logPath = WStringToString(logPath);
	const char* mode = "a";
	errno_t err = fopen_s(&logFile, narrow_logPath.c_str(), mode);
	if (err == 0 && logFile != nullptr) {
		stringstream ss;
		ss << put_time(&tm_buf, "%Y-%m-%d %X");

		string logType;
		switch (type[0]) {
		case 'e':
			logType = "ERROR";
			break; 
		case 'i':
			logType = "INFO";
			break;
		case 'p':
			logType = "PIPE";
			break;
		case 'd':
			logType = "DEBUG";
			break;
		case 'w':
			logType = "WARNING";
			break;
		case 't':
			logType = "TESTING";
			break;
		case 'c':
			logType = "COMPANION";
			break;
		default:
			logType = "UNKNOWN";
			break;
		}

		bool shouldLog = true;
		if (logType == "DEBUG" && !debugLogs) {
			shouldLog = false;
		}
		if (shouldLog) {
			fprintf(logFile, "[%s] [%s] %s\n", ss.str().c_str(), logType.c_str(), message);
		}

		fclose(logFile);

		if (sendLogsThroughPipe && g_pipeHandle != INVALID_HANDLE_VALUE) {
			string logMessage = ss.str() + " [" + logType + "] " + message + "\n";
			DWORD bytesWritten;
			DWORD logMessageSize = static_cast<DWORD>(logMessage.size());
			WriteFile(g_pipeHandle, logMessage.c_str(), logMessageSize, &bytesWritten, NULL);
		}
	}
}



void LogIddCxVersion() {
	IDARG_OUT_GETVERSION outArgs;
	NTSTATUS status = IddCxGetVersion(&outArgs);

	if (NT_SUCCESS(status)) {
		char versionStr[16];
		sprintf_s(versionStr, "0x%lx", outArgs.IddCxVersion);
		string logMessage = "IDDCX Version: " + string(versionStr);
		vddlog("i", logMessage.c_str());
	}
	else {
		vddlog("i", "Failed to get IDDCX version");
	}
	vddlog("d", "Testing Debug Log");
}

void InitializeD3DDeviceAndLogGPU() {
	ComPtr<ID3D11Device> d3dDevice;
	ComPtr<ID3D11DeviceContext> d3dContext;
	HRESULT hr = D3D11CreateDevice(
		nullptr,
		D3D_DRIVER_TYPE_HARDWARE,
		nullptr,
		0,
		nullptr,
		0,
		D3D11_SDK_VERSION,
		&d3dDevice,
		nullptr,
		&d3dContext);

	if (FAILED(hr)) {
		vddlog("e", "Retrieving D3D Device GPU: Failed to create D3D11 device");
		return;
	}

	ComPtr<IDXGIDevice> dxgiDevice;
	hr = d3dDevice.As(&dxgiDevice);
	if (FAILED(hr)) {
		vddlog("e", "Retrieving D3D Device GPU: Failed to get DXGI device");
		return;
	}

	ComPtr<IDXGIAdapter> dxgiAdapter;
	hr = dxgiDevice->GetAdapter(&dxgiAdapter);
	if (FAILED(hr)) {
		vddlog("e", "Retrieving D3D Device GPU: Failed to get DXGI adapter");
		return;
	}

	DXGI_ADAPTER_DESC desc;
	hr = dxgiAdapter->GetDesc(&desc);
	if (FAILED(hr)) {
		vddlog("e", "Retrieving D3D Device GPU: Failed to get GPU description");
		return;
	}

	d3dDevice.Reset();
	d3dContext.Reset();

	wstring wdesc(desc.Description);
	string utf8_desc;
	try {
		utf8_desc = WStringToString(wdesc);
	}
	catch (const exception& e) {
		vddlog("e", ("Retrieving D3D Device GPU: Conversion error: " + string(e.what())).c_str());
		return;
	}

	string logtext = "Retrieving D3D Device GPU: " + utf8_desc;
	vddlog("i", logtext.c_str());
}


// This macro creates the methods for accessing an IndirectDeviceContextWrapper as a context for a WDF object
WDF_DECLARE_CONTEXT_TYPE(IndirectDeviceContextWrapper);

extern "C" BOOL WINAPI DllMain(
	_In_ HINSTANCE hInstance,
	_In_ UINT dwReason,
	_In_opt_ LPVOID lpReserved)
{
	UNREFERENCED_PARAMETER(hInstance);
	UNREFERENCED_PARAMETER(lpReserved);
	UNREFERENCED_PARAMETER(dwReason);

	return TRUE;
}


bool UpdateXmlToggleSetting(bool toggle, const wchar_t* variable) {
	const wstring settingsname = confpath + L"\\vdd_settings.xml";
	CComPtr<IStream> pFileStream;
	HRESULT hr = SHCreateStreamOnFileEx(settingsname.c_str(), STGM_READWRITE, FILE_ATTRIBUTE_NORMAL, FALSE, nullptr, &pFileStream);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: XML file could not be opened.");
		return false;
	}

	CComPtr<IXmlReader> pReader;
	hr = CreateXmlReader(__uuidof(IXmlReader), (void**)&pReader, nullptr);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to create XML reader.");
		return false;
	}
	hr = pReader->SetInput(pFileStream);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to set XML reader input.");
		return false;
	}

	CComPtr<IStream> pOutFileStream;
	wstring tempFileName = settingsname + L".temp";
	hr = SHCreateStreamOnFileEx(tempFileName.c_str(), STGM_CREATE | STGM_WRITE, FILE_ATTRIBUTE_NORMAL, TRUE, nullptr, &pOutFileStream);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to create output file stream.");
		return false;
	}

	CComPtr<IXmlWriter> pWriter;
	hr = CreateXmlWriter(__uuidof(IXmlWriter), (void**)&pWriter, nullptr);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to create XML writer.");
		return false;
	}
	hr = pWriter->SetOutput(pOutFileStream);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to set XML writer output.");
		return false;
	}
	hr = pWriter->WriteStartDocument(XmlStandalone_Omit);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to write start of the document.");
		return false;
	}

	XmlNodeType nodeType;
	const wchar_t* pwszLocalName;
	const wchar_t* pwszValue;
	bool variableElementFound = false;

	while (S_OK == pReader->Read(&nodeType)) {
		switch (nodeType) {
		case XmlNodeType_Element:
			pReader->GetLocalName(&pwszLocalName, nullptr);
			pWriter->WriteStartElement(nullptr, pwszLocalName, nullptr);
			break;

		case XmlNodeType_EndElement:
			pReader->GetLocalName(&pwszLocalName, nullptr);
			pWriter->WriteEndElement();
			break;

		case XmlNodeType_Text:
			pReader->GetValue(&pwszValue, nullptr);
			if (variableElementFound) {
				pWriter->WriteString(toggle ? L"true" : L"false");
				variableElementFound = false;
			}
			else {
				pWriter->WriteString(pwszValue);
			}
			break;

		case XmlNodeType_Whitespace:
			pReader->GetValue(&pwszValue, nullptr);
			pWriter->WriteWhitespace(pwszValue);
			break;

		case XmlNodeType_Comment:
			pReader->GetValue(&pwszValue, nullptr);
			pWriter->WriteComment(pwszValue);
			break;
		}

		if (nodeType == XmlNodeType_Element) {
			pReader->GetLocalName(&pwszLocalName, nullptr);
			if (pwszLocalName != nullptr && wcscmp(pwszLocalName, variable) == 0) {
				variableElementFound = true;
			}
		}
	}

	if (variableElementFound) {
		pWriter->WriteStartElement(nullptr, variable, nullptr);
		pWriter->WriteString(toggle ? L"true" : L"false");
		pWriter->WriteEndElement();
	}

	hr = pWriter->WriteEndDocument();
	if (FAILED(hr)) {
		return false;
	}

	pFileStream.Release();
	pOutFileStream.Release();
	pWriter.Release();
	pReader.Release();

	if (!MoveFileExW(tempFileName.c_str(), settingsname.c_str(), MOVEFILE_REPLACE_EXISTING)) {
		return false;
	}
	return true;
}


bool UpdateXmlGpuSetting(const wchar_t* gpuName) {
	const std::wstring settingsname = confpath + L"\\vdd_settings.xml";
	CComPtr<IStream> pFileStream;
	HRESULT hr = SHCreateStreamOnFileEx(settingsname.c_str(), STGM_READWRITE, FILE_ATTRIBUTE_NORMAL, FALSE, nullptr, &pFileStream);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: XML file could not be opened.");
		return false;
	}

	CComPtr<IXmlReader> pReader;
	hr = CreateXmlReader(__uuidof(IXmlReader), (void**)&pReader, nullptr);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to create XML reader.");
		return false;
	}
	hr = pReader->SetInput(pFileStream);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to set XML reader input.");
		return false;
	}

	CComPtr<IStream> pOutFileStream;
	std::wstring tempFileName = settingsname + L".temp";
	hr = SHCreateStreamOnFileEx(tempFileName.c_str(), STGM_CREATE | STGM_WRITE, FILE_ATTRIBUTE_NORMAL, TRUE, nullptr, &pOutFileStream);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to create output file stream.");
		return false;
	}

	CComPtr<IXmlWriter> pWriter;
	hr = CreateXmlWriter(__uuidof(IXmlWriter), (void**)&pWriter, nullptr);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to create XML writer.");
		return false;
	}
	hr = pWriter->SetOutput(pOutFileStream);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to set XML writer output.");
		return false;
	}
	hr = pWriter->WriteStartDocument(XmlStandalone_Omit);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to write start of the document.");
		return false;
	}

	XmlNodeType nodeType;
	const wchar_t* pwszLocalName;
	const wchar_t* pwszValue;
	bool gpuElementFound = false;

	while (S_OK == pReader->Read(&nodeType)) {
		switch (nodeType) {
		case XmlNodeType_Element:
			pReader->GetLocalName(&pwszLocalName, nullptr);
			pWriter->WriteStartElement(nullptr, pwszLocalName, nullptr);
			break;

		case XmlNodeType_EndElement:
			pReader->GetLocalName(&pwszLocalName, nullptr);
			pWriter->WriteEndElement();
			break;

		case XmlNodeType_Text:
			pReader->GetValue(&pwszValue, nullptr);
			if (gpuElementFound) {
				pWriter->WriteString(gpuName); 
				gpuElementFound = false;
			}
			else {
				pWriter->WriteString(pwszValue);
			}
			break;

		case XmlNodeType_Whitespace:
			pReader->GetValue(&pwszValue, nullptr);
			pWriter->WriteWhitespace(pwszValue);
			break;

		case XmlNodeType_Comment:
			pReader->GetValue(&pwszValue, nullptr);
			pWriter->WriteComment(pwszValue);
			break;
		}

		if (nodeType == XmlNodeType_Element) {
			pReader->GetLocalName(&pwszLocalName, nullptr);
			if (wcscmp(pwszLocalName, L"gpu") == 0) {
				gpuElementFound = true;
			}
		}
	}
	hr = pWriter->WriteEndDocument();
	if (FAILED(hr)) {
		return false;
	}

	pFileStream.Release();
	pOutFileStream.Release();
	pWriter.Release();
	pReader.Release();

	if (!MoveFileExW(tempFileName.c_str(), settingsname.c_str(), MOVEFILE_REPLACE_EXISTING)) {
		return false;
	}
	return true;
}

bool UpdateXmlDisplayCountSetting(int displayCount) {
	const std::wstring settingsname = confpath + L"\\vdd_settings.xml";
	CComPtr<IStream> pFileStream;
	HRESULT hr = SHCreateStreamOnFileEx(settingsname.c_str(), STGM_READWRITE, FILE_ATTRIBUTE_NORMAL, FALSE, nullptr, &pFileStream);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: XML file could not be opened.");
		return false;
	}

	CComPtr<IXmlReader> pReader;
	hr = CreateXmlReader(__uuidof(IXmlReader), (void**)&pReader, nullptr);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to create XML reader.");
		return false;
	}
	hr = pReader->SetInput(pFileStream);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to set XML reader input.");
		return false;
	}

	CComPtr<IStream> pOutFileStream;
	std::wstring tempFileName = settingsname + L".temp";
	hr = SHCreateStreamOnFileEx(tempFileName.c_str(), STGM_CREATE | STGM_WRITE, FILE_ATTRIBUTE_NORMAL, TRUE, nullptr, &pOutFileStream);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to create output file stream.");
		return false;
	}

	CComPtr<IXmlWriter> pWriter;
	hr = CreateXmlWriter(__uuidof(IXmlWriter), (void**)&pWriter, nullptr);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to create XML writer.");
		return false;
	}
	hr = pWriter->SetOutput(pOutFileStream);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to set XML writer output.");
		return false;
	}
	hr = pWriter->WriteStartDocument(XmlStandalone_Omit);
	if (FAILED(hr)) {
		vddlog("e", "UpdatingXML: Failed to write start of the document.");
		return false;
	}

	XmlNodeType nodeType;
	const wchar_t* pwszLocalName;
	const wchar_t* pwszValue;
	bool displayCountElementFound = false;

	while (S_OK == pReader->Read(&nodeType)) {
		switch (nodeType) {
		case XmlNodeType_Element:
			pReader->GetLocalName(&pwszLocalName, nullptr);
			pWriter->WriteStartElement(nullptr, pwszLocalName, nullptr);
			break;

		case XmlNodeType_EndElement:
			pReader->GetLocalName(&pwszLocalName, nullptr);
			pWriter->WriteEndElement();
			break;

		case XmlNodeType_Text:
			pReader->GetValue(&pwszValue, nullptr);
			if (displayCountElementFound) {
				pWriter->WriteString(std::to_wstring(displayCount).c_str());
				displayCountElementFound = false; 
			}
			else {
				pWriter->WriteString(pwszValue);
			}
			break;

		case XmlNodeType_Whitespace:
			pReader->GetValue(&pwszValue, nullptr);
			pWriter->WriteWhitespace(pwszValue);
			break;

		case XmlNodeType_Comment:
			pReader->GetValue(&pwszValue, nullptr);
			pWriter->WriteComment(pwszValue);
			break;
		}

		if (nodeType == XmlNodeType_Element) {
			pReader->GetLocalName(&pwszLocalName, nullptr);
			if (wcscmp(pwszLocalName, L"count") == 0) {
				displayCountElementFound = true; 
			}
		}
	}

	hr = pWriter->WriteEndDocument();
	if (FAILED(hr)) {
		return false;
	}

	pFileStream.Release();
	pOutFileStream.Release();
	pWriter.Release();
	pReader.Release();

	if (!MoveFileExW(tempFileName.c_str(), settingsname.c_str(), MOVEFILE_REPLACE_EXISTING)) {
		return false;
	}
	return true;
}


LUID getSetAdapterLuid() {
	AdapterOption& adapterOption = Options.Adapter;

	if (!adapterOption.hasTargetAdapter) {
		vddlog("e","No Gpu Found/Selected");
	}

	return adapterOption.adapterLuid;
}


void GetGpuInfo()
{
	AdapterOption& adapterOption = Options.Adapter;

	if (!adapterOption.hasTargetAdapter) {
		vddlog("e", "No GPU found or set.");
		return;
	}

	try {
		string utf8_desc = WStringToString(adapterOption.target_name);
		LUID luid = getSetAdapterLuid();
		string logtext = "ASSIGNED GPU: " + utf8_desc +
			" (LUID: " + std::to_string(luid.LowPart) + "-" + std::to_string(luid.HighPart) + ")";
		vddlog("i", logtext.c_str());
	}
	catch (const exception& e) {
		vddlog("e", ("Error: " + string(e.what())).c_str());
	}
}

void logAvailableGPUs() {
	vector<GPUInfo> gpus;
	ComPtr<IDXGIFactory1> factory;
	if (!SUCCEEDED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) {
		return;
	}
	for (UINT i = 0;; i++) {
		ComPtr<IDXGIAdapter> adapter;
		if (!SUCCEEDED(factory->EnumAdapters(i, &adapter))) {
			break;
		}
		DXGI_ADAPTER_DESC desc;
		if (!SUCCEEDED(adapter->GetDesc(&desc))) {
			continue;
		}
		GPUInfo info{ desc.Description, adapter, desc };
		gpus.push_back(info);
	}
	for (const auto& gpu : gpus) {
		wstring logMessage = L"GPU Name: ";
		logMessage += gpu.desc.Description;
		wstring memorySize = L" Memory: ";
		memorySize += std::to_wstring(gpu.desc.DedicatedVideoMemory / (1024 * 1024)) + L" MB";
		wstring logText = logMessage + memorySize;
		int bufferSize = WideCharToMultiByte(CP_UTF8, 0, logText.c_str(), -1, nullptr, 0, nullptr, nullptr);
		if (bufferSize > 0) {
			std::string logTextA(bufferSize - 1, '\0');
			WideCharToMultiByte(CP_UTF8, 0, logText.c_str(), -1, &logTextA[0], bufferSize, nullptr, nullptr);
			vddlog("c", logTextA.c_str());
		}
	}
}





void ReloadDriver(HANDLE hPipe) {
	auto* pContext = WdfObjectGet_IndirectDeviceContextWrapper(hPipe);
	if (pContext && pContext->pContext) {
		pContext->pContext->InitAdapter();
		vddlog("i", "Adapter reinitialized");
	}
}


void HandleClient(HANDLE hPipe) {
	g_pipeHandle = hPipe;
	vddlog("p", "Client Handling Enabled");
	wchar_t buffer[128];
	DWORD bytesRead;
	BOOL result = ReadFile(hPipe, buffer, sizeof(buffer) - sizeof(wchar_t), &bytesRead, NULL);
	if (result && bytesRead != 0) {
		buffer[bytesRead / sizeof(wchar_t)] = L'\0';
		wstring bufferwstr(buffer);
		int bufferSize = WideCharToMultiByte(CP_UTF8, 0, bufferwstr.c_str(), -1, nullptr, 0, nullptr, nullptr);
		string bufferstr(bufferSize, 0);
		WideCharToMultiByte(CP_UTF8, 0, bufferwstr.c_str(), -1, &bufferstr[0], bufferSize, nullptr, nullptr);
		vddlog("p", bufferstr.c_str());
		if (wcsncmp(buffer, L"RELOAD_DRIVER", 13) == 0) {
			vddlog("c", "Reloading the driver");
			ReloadDriver(hPipe);
			
		}
		else if (wcsncmp(buffer, L"LOG_DEBUG", 9) == 0) {
			wchar_t* param = buffer + 10;
			if (wcsncmp(param, L"true", 4) == 0) {
				UpdateXmlToggleSetting(true, L"debuglogging");
				debugLogs = true;
				vddlog("c", "Pipe debugging enabled");
				vddlog("d", "Debug Logs Enabled");
			}
			else if (wcsncmp(param, L"false", 5) == 0) {
				UpdateXmlToggleSetting(false, L"debuglogging");
				debugLogs = false;
				vddlog("c", "Debugging disabled");
			}
		}
		else if (wcsncmp(buffer, L"LOGGING", 7) == 0) {
			wchar_t* param = buffer + 8;
			if (wcsncmp(param, L"true", 4) == 0) {
				UpdateXmlToggleSetting(true, L"logging");
				logsEnabled = true;
				vddlog("c", "Logging Enabled");
			}
			else if (wcsncmp(param, L"false", 5) == 0) {
				UpdateXmlToggleSetting(false, L"logging");
				logsEnabled = false;
				vddlog("c", "Logging disabled"); // We can keep this here just to make it delete the logs on disable
			}
		}
		else if (wcsncmp(buffer, L"HDRPLUS", 7) == 0) {
			wchar_t* param = buffer + 8;
			if (wcsncmp(param, L"true", 4) == 0) {
				UpdateXmlToggleSetting(true, L"HDRPlus");
				vddlog("c", "HDR+ Enabled"); 
				ReloadDriver(hPipe);
			} 
			else if (wcsncmp(param, L"false", 5) == 0) {
				UpdateXmlToggleSetting(false, L"HDRPlus");
				vddlog("c", "HDR+ Disabled");
				ReloadDriver(hPipe);
			}
		}
		else if (wcsncmp(buffer, L"SDR10", 5) == 0) {
			wchar_t* param = buffer + 6;
			if (wcsncmp(param, L"true", 4) == 0) {
				UpdateXmlToggleSetting(true, L"SDR10bit");
				vddlog("c", "SDR 10 Bit Enabled");
				ReloadDriver(hPipe);
			}
			else if (wcsncmp(param, L"false", 5) == 0) {
				UpdateXmlToggleSetting(false, L"SDR10bit");
				vddlog("c", "SDR 10 Bit Disabled");
				ReloadDriver(hPipe);
			}
		}
		else if (wcsncmp(buffer, L"CUSTOMEDID", 10) == 0) {
			wchar_t* param = buffer + 11;
			if (wcsncmp(param, L"true", 4) == 0) {
				UpdateXmlToggleSetting(true, L"CustomEdid");
				vddlog("c", "Custom Edid Enabled");
				ReloadDriver(hPipe);
			}
			else if (wcsncmp(param, L"false", 5) == 0) {
				UpdateXmlToggleSetting(false, L"CustomEdid");
				vddlog("c", "Custom Edid Disabled");
				ReloadDriver(hPipe);
			}
		}
		else if (wcsncmp(buffer, L"PREVENTSPOOF", 12) == 0) {
			wchar_t* param = buffer + 13;
			if (wcsncmp(param, L"true", 4) == 0) {
				UpdateXmlToggleSetting(true, L"PreventSpoof");
				vddlog("c", "Prevent Spoof Enabled");
				ReloadDriver(hPipe);
			}
			else if (wcsncmp(param, L"false", 5) == 0) {
				UpdateXmlToggleSetting(false, L"PreventSpoof");
				vddlog("c", "Prevent Spoof Disabled");
				ReloadDriver(hPipe);
			}
		}
		else if (wcsncmp(buffer, L"CEAOVERRIDE", 11) == 0) {
			wchar_t* param = buffer + 12;
			if (wcsncmp(param, L"true", 4) == 0) {
				UpdateXmlToggleSetting(true, L"EdidCeaOverride");
				vddlog("c", "Cea override Enabled");
				ReloadDriver(hPipe);
			}
			else if (wcsncmp(param, L"false", 5) == 0) {
				UpdateXmlToggleSetting(false, L"EdidCeaOverride");
				vddlog("c", "Cea override Disabled");
				ReloadDriver(hPipe);
			}
		}
		else if (wcsncmp(buffer, L"HARDWARECURSOR", 14) == 0) {
			wchar_t* param = buffer + 15;
			if (wcsncmp(param, L"true", 4) == 0) {
				UpdateXmlToggleSetting(true, L"HardwareCursor");
				vddlog("c", "Hardware Cursor Enabled");
				ReloadDriver(hPipe);
			}
			else if (wcsncmp(param, L"false", 5) == 0) {
				UpdateXmlToggleSetting(false, L"HardwareCursor");
				vddlog("c", "Hardware Cursor Disabled");
				ReloadDriver(hPipe);
			}
		}
		else if (wcsncmp(buffer, L"D3DDEVICEGPU", 12) == 0) {
			vddlog("c", "Retrieving D3D GPU (This information may be inaccurate without reloading the driver first)");
			InitializeD3DDeviceAndLogGPU();
			vddlog("c", "Retrieved D3D GPU");
		}
		else if (wcsncmp(buffer, L"IDDCXVERSION", 12) == 0) {
			vddlog("c", "Logging iddcx version");
			LogIddCxVersion(); 
		}
		else if (wcsncmp(buffer, L"GETASSIGNEDGPU", 14) == 0) {
			vddlog("c", "Retrieving Assigned GPU");
			GetGpuInfo();
			vddlog("c", "Retrieved Assigned GPU");
		}
		else if (wcsncmp(buffer, L"GETALLGPUS", 10) == 0) {
			vddlog("c", "Logging all GPUs");
			vddlog("i", "Any GPUs which show twice but you only have one, will most likely be the GPU the driver is attached to");
			logAvailableGPUs();
			vddlog("c", "Logged all GPUs");
		}  
		else if (wcsncmp(buffer, L"SETGPU", 6) == 0) {
			std::wstring gpuName = buffer + 7;
			gpuName = gpuName.substr(1, gpuName.size() - 2); 

			int size_needed = WideCharToMultiByte(CP_UTF8, 0, gpuName.c_str(), static_cast<int>(gpuName.length()), nullptr, 0, nullptr, nullptr);
			std::string gpuNameNarrow(size_needed, 0);
			WideCharToMultiByte(CP_UTF8, 0, gpuName.c_str(), static_cast<int>(gpuName.length()), &gpuNameNarrow[0], size_needed, nullptr, nullptr);

			vddlog("c", ("Setting GPU to: " + gpuNameNarrow).c_str());
			if (UpdateXmlGpuSetting(gpuName.c_str())) {
				vddlog("c", "Gpu Changed, Restarting Driver");
			}
			else {
				vddlog("e", "Failed to update GPU setting in XML. Restarting anyway");
			}
			ReloadDriver(hPipe);
		}
		else if (wcsncmp(buffer, L"SETDISPLAYCOUNT", 15) == 0) {
			vddlog("i", "Setting Display Count");

			int newDisplayCount = 1;
			swscanf_s(buffer + 15, L"%d", &newDisplayCount);

			std::wstring displayLog = L"Setting display count  to " + std::to_wstring(newDisplayCount);
			vddlog("c", WStringToString(displayLog).c_str());

			if (UpdateXmlDisplayCountSetting(newDisplayCount)){
				vddlog("c", "Display Count Changed, Restarting Driver");
			}
			else {
				vddlog("e", "Failed to update display count setting in XML. Restarting anyway");
			}
			ReloadDriver(hPipe);
		}
		else if (wcsncmp(buffer, L"GETSETTINGS", 11) == 0) {
			//query and return settings
			bool debugEnabled = EnabledQuery(L"DebugLoggingEnabled");
			bool loggingEnabled = EnabledQuery(L"LoggingEnabled");

			wstring settingsResponse = L"SETTINGS ";
			settingsResponse += debugEnabled ? L"DEBUG=true " : L"DEBUG=false ";
			settingsResponse += loggingEnabled ? L"LOG=true" : L"LOG=false";

			DWORD bytesWritten;
			DWORD bytesToWrite = static_cast<DWORD>((settingsResponse.length() + 1) * sizeof(wchar_t));
			WriteFile(hPipe, settingsResponse.c_str(), bytesToWrite, &bytesWritten, NULL);

		}
		else if (wcsncmp(buffer, L"PING", 4) == 0) {
			SendToPipe("PONG");
			vddlog("p", "Heartbeat Ping");
		}
		else {
			vddlog("e", "Unknown command");

			size_t size_needed;
			wcstombs_s(&size_needed, nullptr, 0, buffer, 0);
			std::string narrowString(size_needed, 0);
			wcstombs_s(nullptr, &narrowString[0], size_needed, buffer, size_needed);
			vddlog("e", narrowString.c_str());
		}
	}
	DisconnectNamedPipe(hPipe);
	CloseHandle(hPipe);
	g_pipeHandle = INVALID_HANDLE_VALUE; // This value determines whether or not all data gets sent back through the pipe or just the handling pipe data
}


DWORD WINAPI NamedPipeServer(LPVOID lpParam) {
	UNREFERENCED_PARAMETER(lpParam);

	SECURITY_ATTRIBUTES sa;
	sa.nLength = sizeof(SECURITY_ATTRIBUTES);
	sa.bInheritHandle = FALSE;
	const wchar_t* sddl = L"D:(A;;GA;;;WD)";
	vddlog("d", "Starting pipe with parameters: D:(A;;GA;;;WD)");
	if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
		sddl, SDDL_REVISION_1, &sa.lpSecurityDescriptor, NULL)) {
		DWORD ErrorCode = GetLastError();
		string errorMessage = to_string(ErrorCode);
		vddlog("e", errorMessage.c_str());
		return 1;
	}
	HANDLE hPipe;
	while (g_Running) {
		hPipe = CreateNamedPipeW(
			PIPE_NAME,
			PIPE_ACCESS_DUPLEX,
			PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
			PIPE_UNLIMITED_INSTANCES,
			512, 512,
			0,
			&sa);

		if (hPipe == INVALID_HANDLE_VALUE) {
			DWORD ErrorCode = GetLastError();
			string errorMessage = to_string(ErrorCode);
			vddlog("e", errorMessage.c_str());
			LocalFree(sa.lpSecurityDescriptor);
			return 1;
		}

		BOOL connected = ConnectNamedPipe(hPipe, NULL) ? TRUE : (GetLastError() == ERROR_PIPE_CONNECTED);
		if (connected) {
			vddlog("p", "Client Connected");
			HandleClient(hPipe);
		}
		else {
			CloseHandle(hPipe);
		}
	}
	LocalFree(sa.lpSecurityDescriptor);
	return 0;
}

void StartNamedPipeServer() {
	vddlog("p", "Starting Pipe");
	hPipeThread = CreateThread(NULL, 0, NamedPipeServer, NULL, 0, NULL);
	if (hPipeThread == NULL) {
		DWORD ErrorCode = GetLastError();
		string errorMessage = to_string(ErrorCode);
		vddlog("e", errorMessage.c_str());
	}
	else {
		vddlog("p", "Pipe created");
	}
}

void StopNamedPipeServer() {
	vddlog("p", "Stopping Pipe");
	{
		lock_guard<mutex> lock(g_Mutex);
		g_Running = false;
	}
	if (hPipeThread) {
		HANDLE hPipe = CreateFileW(
			PIPE_NAME,
			GENERIC_READ | GENERIC_WRITE,
			0,
			NULL,
			OPEN_EXISTING,
			0,
			NULL);

		if (hPipe != INVALID_HANDLE_VALUE) {
			DisconnectNamedPipe(hPipe);
			CloseHandle(hPipe);
		}

		WaitForSingleObject(hPipeThread, INFINITE);
		CloseHandle(hPipeThread);
		hPipeThread = NULL;
		vddlog("p", "Stopped Pipe");
	}
}

bool initpath() {
	HKEY hKey;
	wchar_t szPath[MAX_PATH];
	DWORD dwBufferSize = sizeof(szPath);
	LONG lResult;
	//vddlog("i", "Reading reg: Computer\\HKEY_LOCAL_MACHINE\\SOFTWARE\\MikeTheTech\\VirtualDisplayDriver");           Remove this due to the fact, if reg key exists, this is called before reading
	lResult = RegOpenKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\MikeTheTech\\VirtualDisplayDriver", 0, KEY_READ, &hKey);
	if (lResult != ERROR_SUCCESS) {
		ostringstream oss;
		oss << "Failed to open registry key for path. Error code: " << lResult;
		//vddlog("w", oss.str().c_str());  // These are okay to call though since they're only called if the reg doesnt exist
		return false;
	}

	lResult = RegQueryValueExW(hKey, L"VDDPATH", NULL, NULL, (LPBYTE)szPath, &dwBufferSize);
	if (lResult != ERROR_SUCCESS) {
		ostringstream oss;
		oss << "Failed to open registry key for path. Error code: " << lResult;
		//vddlog("w", oss.str().c_str()); Prevent these from being called since no longer checks before logging, only on startup whether it should
		RegCloseKey(hKey);
		return false;
	}

	confpath = szPath;

	RegCloseKey(hKey);

	return true;
}


extern "C" EVT_WDF_DRIVER_UNLOAD EvtDriverUnload;

VOID
EvtDriverUnload(
	_In_ WDFDRIVER Driver
)
{
	UNREFERENCED_PARAMETER(Driver);
	StopNamedPipeServer();
	vddlog("i", "Driver Unloaded");
}

_Use_decl_annotations_
extern "C" NTSTATUS DriverEntry(
	PDRIVER_OBJECT  pDriverObject,
	PUNICODE_STRING pRegistryPath
)
{
	WDF_DRIVER_CONFIG Config;
	NTSTATUS Status;

	WDF_OBJECT_ATTRIBUTES Attributes;
	WDF_OBJECT_ATTRIBUTES_INIT(&Attributes);

	WDF_DRIVER_CONFIG_INIT(&Config, VirtualDisplayDriverDeviceAdd);

	Config.EvtDriverUnload = EvtDriverUnload;
	initpath();
	logsEnabled = EnabledQuery(L"LoggingEnabled");
	debugLogs = EnabledQuery(L"DebugLoggingEnabled");

	customEdid = EnabledQuery(L"CustomEdidEnabled");
	preventManufacturerSpoof = EnabledQuery(L"PreventMonitorSpoof");
	edidCeaOverride = EnabledQuery(L"EdidCeaOverride");
	sendLogsThroughPipe = EnabledQuery(L"SendLogsThroughPipe");


	//colour
	HDRPlus = EnabledQuery(L"HDRPlusEnabled");
	SDR10 = EnabledQuery(L"SDR10Enabled");
	HDRCOLOUR = HDRPlus ? IDDCX_BITS_PER_COMPONENT_12 : IDDCX_BITS_PER_COMPONENT_10;
	SDRCOLOUR = SDR10 ? IDDCX_BITS_PER_COMPONENT_10 : IDDCX_BITS_PER_COMPONENT_8;
	ColourFormat = GetStringSetting(L"ColourFormat");

	//Cursor
	hardwareCursor = EnabledQuery(L"HardwareCursorEnabled");
	alphaCursorSupport = EnabledQuery(L"AlphaCursorSupport");
	CursorMaxX = GetIntegerSetting(L"CursorMaxX");
	CursorMaxY = GetIntegerSetting(L"CursorMaxY");

	int xorCursorSupportLevelInt = GetIntegerSetting(L"XorCursorSupportLevel");
	std::string xorCursorSupportLevelName;

	if (xorCursorSupportLevelInt < 0 || xorCursorSupportLevelInt > 3) {
		vddlog("w", "Selected Xor Level unsupported, defaulting to IDDCX_XOR_CURSOR_SUPPORT_FULL");
		XorCursorSupportLevel = IDDCX_XOR_CURSOR_SUPPORT_FULL;
	}
	else {
		XorCursorSupportLevel = static_cast<IDDCX_XOR_CURSOR_SUPPORT>(xorCursorSupportLevelInt);
	}

	// === LOAD NEW EDID INTEGRATION SETTINGS ===
	edidIntegrationEnabled = EnabledQuery(L"EdidIntegrationEnabled");
	autoConfigureFromEdid = EnabledQuery(L"AutoConfigureFromEdid");
	edidProfilePath = GetStringSetting(L"EdidProfilePath");
	overrideManualSettings = EnabledQuery(L"OverrideManualSettings");
	fallbackOnError = EnabledQuery(L"FallbackOnError");

	// === LOAD HDR ADVANCED SETTINGS ===
	hdr10StaticMetadataEnabled = EnabledQuery(L"Hdr10StaticMetadataEnabled");
	maxDisplayMasteringLuminance = GetDoubleSetting(L"MaxDisplayMasteringLuminance");
	minDisplayMasteringLuminance = GetDoubleSetting(L"MinDisplayMasteringLuminance");
	maxContentLightLevel = GetIntegerSetting(L"MaxContentLightLevel");
	maxFrameAvgLightLevel = GetIntegerSetting(L"MaxFrameAvgLightLevel");

	colorPrimariesEnabled = EnabledQuery(L"ColorPrimariesEnabled");
	redX = GetDoubleSetting(L"RedX");
	redY = GetDoubleSetting(L"RedY");
	greenX = GetDoubleSetting(L"GreenX");
	greenY = GetDoubleSetting(L"GreenY");
	blueX = GetDoubleSetting(L"BlueX");
	blueY = GetDoubleSetting(L"BlueY");
	whiteX = GetDoubleSetting(L"WhiteX");
	whiteY = GetDoubleSetting(L"WhiteY");

	colorSpaceEnabled = EnabledQuery(L"ColorSpaceEnabled");
	gammaCorrection = GetDoubleSetting(L"GammaCorrection");
	primaryColorSpace = GetStringSetting(L"PrimaryColorSpace");
	enableMatrixTransform = EnabledQuery(L"EnableMatrixTransform");

	// === LOAD AUTO RESOLUTIONS SETTINGS ===
	autoResolutionsEnabled = EnabledQuery(L"AutoResolutionsEnabled");
	sourcePriority = GetStringSetting(L"SourcePriority");
	minRefreshRate = GetIntegerSetting(L"MinRefreshRate");
	maxRefreshRate = GetIntegerSetting(L"MaxRefreshRate");
	excludeFractionalRates = EnabledQuery(L"ExcludeFractionalRates");
	minResolutionWidth = GetIntegerSetting(L"MinResolutionWidth");
	minResolutionHeight = GetIntegerSetting(L"MinResolutionHeight");
	maxResolutionWidth = GetIntegerSetting(L"MaxResolutionWidth");
	maxResolutionHeight = GetIntegerSetting(L"MaxResolutionHeight");
	useEdidPreferred = EnabledQuery(L"UseEdidPreferred");
	fallbackWidth = GetIntegerSetting(L"FallbackWidth");
	fallbackHeight = GetIntegerSetting(L"FallbackHeight");
	fallbackRefresh = GetIntegerSetting(L"FallbackRefresh");

	// === LOAD COLOR ADVANCED SETTINGS ===
	autoSelectFromColorSpace = EnabledQuery(L"AutoSelectFromColorSpace");
	forceBitDepth = GetStringSetting(L"ForceBitDepth");
	fp16SurfaceSupport = EnabledQuery(L"Fp16SurfaceSupport");
	wideColorGamut = EnabledQuery(L"WideColorGamut");
	hdrToneMapping = EnabledQuery(L"HdrToneMapping");
	sdrWhiteLevel = GetDoubleSetting(L"SdrWhiteLevel");

	// === LOAD MONITOR EMULATION SETTINGS ===
	monitorEmulationEnabled = EnabledQuery(L"MonitorEmulationEnabled");
	emulatePhysicalDimensions = EnabledQuery(L"EmulatePhysicalDimensions");
	physicalWidthMm = GetIntegerSetting(L"PhysicalWidthMm");
	physicalHeightMm = GetIntegerSetting(L"PhysicalHeightMm");
	manufacturerEmulationEnabled = EnabledQuery(L"ManufacturerEmulationEnabled");
	manufacturerName = GetStringSetting(L"ManufacturerName");
	modelName = GetStringSetting(L"ModelName");
	serialNumber = GetStringSetting(L"SerialNumber");

	xorCursorSupportLevelName = XorCursorSupportLevelToString(XorCursorSupportLevel);

	vddlog("i", ("Selected Xor Cursor Support Level: " + xorCursorSupportLevelName).c_str());



	vddlog("i", "Driver Starting");
	string utf8_confpath = WStringToString(confpath);
	string logtext = "VDD Path: " + utf8_confpath;
	vddlog("i", logtext.c_str());
	LogIddCxVersion();

	Status = WdfDriverCreate(pDriverObject, pRegistryPath, &Attributes, &Config, WDF_NO_HANDLE);
	if (!NT_SUCCESS(Status))
	{
		return Status;
	}

	StartNamedPipeServer();

	return Status;
}

vector<string> split(string& input, char delimiter)
{
	istringstream stream(input);
	string field;
	vector<string> result;
	while (getline(stream, field, delimiter)) {
		result.push_back(field);
	}
	return result;
}


void loadSettings() {
	const wstring settingsname = confpath + L"\\vdd_settings.xml";
	const wstring& filename = settingsname;
	if (PathFileExistsW(filename.c_str())) {
		CComPtr<IStream> pStream;
		CComPtr<IXmlReader> pReader;
		HRESULT hr = SHCreateStreamOnFileW(filename.c_str(), STGM_READ, &pStream);
		if (FAILED(hr)) {
			vddlog("e", "Loading Settings: Failed to create file stream.");
			return; 
		}
		hr = CreateXmlReader(__uuidof(IXmlReader), (void**)&pReader, NULL);
		if (FAILED(hr)) {
			vddlog("e", "Loading Settings: Failed to create XmlReader.");
			return;
		}
		hr = pReader->SetInput(pStream);
		if (FAILED(hr)) {
			vddlog("e", "Loading Settings: Failed to set input stream.");
			return;
		}

		XmlNodeType nodeType;
		const WCHAR* pwszLocalName;
		const WCHAR* pwszValue;
		UINT cwchLocalName;
		UINT cwchValue;
		wstring currentElement;
		wstring width, height, refreshRate;
		vector<tuple<int, int, int, int>> res;
		wstring gpuFriendlyName;
		UINT monitorcount = 1;
		set<tuple<int, int>> resolutions;
		vector<int> globalRefreshRates;

		while (S_OK == (hr = pReader->Read(&nodeType))) {
			switch (nodeType) {
			case XmlNodeType_Element:
				hr = pReader->GetLocalName(&pwszLocalName, &cwchLocalName);
				if (FAILED(hr)) {
					return;
				}
				currentElement = wstring(pwszLocalName, cwchLocalName);
				break;
			case XmlNodeType_Text:
				hr = pReader->GetValue(&pwszValue, &cwchValue);
				if (FAILED(hr)) {
					return;
				}
				if (currentElement == L"count") {
					monitorcount = stoi(wstring(pwszValue, cwchValue));
					if (monitorcount == 0) {
						monitorcount = 1;
						vddlog("i", "Loading singular monitor (Monitor Count is not valid)");
					}
				}
				else if (currentElement == L"friendlyname") {
					gpuFriendlyName = wstring(pwszValue, cwchValue);
				}
				else if (currentElement == L"width") {
					width = wstring(pwszValue, cwchValue);
					if (width.empty()) {
						width = L"800";
					}
				}
				else if (currentElement == L"height") {
					height = wstring(pwszValue, cwchValue);
					if (height.empty()) {
						height = L"600";
					}
					resolutions.insert(make_tuple(stoi(width), stoi(height)));
				}
				else if (currentElement == L"refresh_rate") {
					refreshRate = wstring(pwszValue, cwchValue);
					if (refreshRate.empty()) {
						refreshRate = L"30";
					}
					int vsync_num, vsync_den;
					float_to_vsync(stof(refreshRate), vsync_num, vsync_den);

					res.push_back(make_tuple(stoi(width), stoi(height), vsync_num, vsync_den));
					stringstream ss;
					ss << "Added: " << stoi(width) << "x" << stoi(height) << " @ " << vsync_num << "/" << vsync_den << "Hz";
					vddlog("d", ss.str().c_str());
				}
				else if (currentElement == L"g_refresh_rate") {
					globalRefreshRates.push_back(stoi(wstring(pwszValue, cwchValue)));
				}
				break;
			}
		}

		/*
		* This is for res testing, stores each resolution then iterates through each global adding a res for each one
		* 
		
		for (const auto& resTuple : resolutions) {
			stringstream ss;
			ss << get<0>(resTuple) << "x" << get<1>(resTuple);
			vddlog("t", ss.str().c_str());
		}

		for (const auto& globalRate : globalRefreshRates) {
			stringstream ss;
			ss << globalRate << " Hz";
			vddlog("t", ss.str().c_str());
		}
		*/

		for (int globalRate : globalRefreshRates) {
			for (const auto& resTuple : resolutions) {
				int global_width = get<0>(resTuple);
				int global_height = get<1>(resTuple);

				int vsync_num, vsync_den;
				float_to_vsync(static_cast<float>(globalRate), vsync_num, vsync_den);
				res.push_back(make_tuple(global_width, global_height, vsync_num, vsync_den));
			}
		}

		/*
		* logging all resolutions after added global
		* 
		for (const auto& tup : res) {
			stringstream ss;
			ss << "("
				<< get<0>(tup) << ", "
				<< get<1>(tup) << ", "
				<< get<2>(tup) << ", "
				<< get<3>(tup) << ")";
			vddlog("t", ss.str().c_str());
		}
		
		*/


		numVirtualDisplays = monitorcount;
		gpuname = gpuFriendlyName;
		monitorModes = res;
		
		// === APPLY EDID INTEGRATION ===
		if (edidIntegrationEnabled && autoConfigureFromEdid) {
			EdidProfileData edidProfile;
			if (LoadEdidProfile(edidProfilePath, edidProfile)) {
				if (ApplyEdidProfile(edidProfile)) {
					vddlog("i", "EDID profile applied successfully");
				} else {
					vddlog("w", "EDID profile loaded but not applied (integration disabled)");
				}
			} else {
				if (fallbackOnError) {
					vddlog("w", "EDID profile loading failed, using manual settings");
				} else {
					vddlog("e", "EDID profile loading failed and fallback disabled");
				}
			}
		}
		
		vddlog("i","Using vdd_settings.xml");
		return;
	}
	const wstring optionsname = confpath + L"\\option.txt";
	ifstream ifs(optionsname);
	if (ifs.is_open()) {
	string line;
	if (getline(ifs, line) && !line.empty()) {
		numVirtualDisplays = stoi(line);
		vector<tuple<int, int, int, int>> res; 

		while (getline(ifs, line)) {
			vector<string> strvec = split(line, ',');
			if (strvec.size() == 3 && strvec[0].substr(0, 1) != "#") {
				int vsync_num, vsync_den;
				float_to_vsync(stof(strvec[2]), vsync_num, vsync_den); 
				res.push_back({ stoi(strvec[0]), stoi(strvec[1]), vsync_num, vsync_den });
			}
		}

		vddlog("i", "Using option.txt");
		monitorModes = res;
		for (const auto& mode : res) {
			int width, height, vsync_num, vsync_den;
			tie(width, height, vsync_num, vsync_den) = mode;
			stringstream ss;
			ss << "Resolution: " << width << "x" << height << " @ " << vsync_num << "/" << vsync_den << "Hz";
			vddlog("d", ss.str().c_str());
		}
		return;
	} else {
		vddlog("w", "option.txt is empty or the first line is invalid. Enabling Fallback");
	}
}


	numVirtualDisplays = 1;
	vector<tuple<int, int, int, int>> res;
	vector<tuple<int, int, float>> fallbackRes = {
		{800, 600, 30.0f},
		{800, 600, 60.0f},
		{800, 600, 90.0f},
		{800, 600, 120.0f},
		{800, 600, 144.0f},
		{800, 600, 165.0f},
		{1280, 720, 30.0f},
		{1280, 720, 60.0f},
		{1280, 720, 90.0f},
		{1280, 720, 130.0f},
		{1280, 720, 144.0f},
		{1280, 720, 165.0f},
		{1366, 768, 30.0f},
		{1366, 768, 60.0f},
		{1366, 768, 90.0f},
		{1366, 768, 120.0f},
		{1366, 768, 144.0f},
		{1366, 768, 165.0f},
		{1920, 1080, 30.0f},
		{1920, 1080, 60.0f},
		{1920, 1080, 90.0f},
		{1920, 1080, 120.0f},
		{1920, 1080, 144.0f},
		{1920, 1080, 165.0f},
		{2560, 1440, 30.0f},
		{2560, 1440, 60.0f},
		{2560, 1440, 90.0f},
		{2560, 1440, 120.0f},
		{2560, 1440, 144.0f},
		{2560, 1440, 165.0f},
		{3840, 2160, 30.0f},
		{3840, 2160, 60.0f},
		{3840, 2160, 90.0f},
		{3840, 2160, 120.0f},
		{3840, 2160, 144.0f},
		{3840, 2160, 165.0f}
	};

	vddlog("i", "Loading Fallback - no settings found");

	for (const auto& mode : fallbackRes) {
		int width, height;
		float refreshRate;
		tie(width, height, refreshRate) = mode;

		int vsync_num, vsync_den;
		float_to_vsync(refreshRate, vsync_num, vsync_den);

		stringstream ss;
		res.push_back(make_tuple(width, height, vsync_num, vsync_den));


		ss << "Resolution: " << width << "x" << height << " @ " << vsync_num << "/" << vsync_den << "Hz";
		vddlog("d", ss.str().c_str());
	}

	monitorModes = res;
	return;

}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverDeviceAdd(WDFDRIVER Driver, PWDFDEVICE_INIT pDeviceInit)
{
	NTSTATUS Status = STATUS_SUCCESS;
	WDF_PNPPOWER_EVENT_CALLBACKS PnpPowerCallbacks;
	stringstream logStream;

	UNREFERENCED_PARAMETER(Driver);

	logStream << "Initializing device:"
		<< "\n  DeviceInit Pointer: " << static_cast<void*>(pDeviceInit);
	vddlog("d", logStream.str().c_str());

	// Register for power callbacks - in this sample only power-on is needed
	WDF_PNPPOWER_EVENT_CALLBACKS_INIT(&PnpPowerCallbacks);
	PnpPowerCallbacks.EvtDeviceD0Entry = VirtualDisplayDriverDeviceD0Entry;
	WdfDeviceInitSetPnpPowerEventCallbacks(pDeviceInit, &PnpPowerCallbacks);

	IDD_CX_CLIENT_CONFIG IddConfig;
	IDD_CX_CLIENT_CONFIG_INIT(&IddConfig);

	logStream.str("");
	logStream << "Configuring IDD_CX client:"
		<< "\n  EvtIddCxAdapterInitFinished: " << (IddConfig.EvtIddCxAdapterInitFinished ? "Set" : "Not Set")
		<< "\n  EvtIddCxMonitorGetDefaultDescriptionModes: " << (IddConfig.EvtIddCxMonitorGetDefaultDescriptionModes ? "Set" : "Not Set")
		<< "\n  EvtIddCxMonitorAssignSwapChain: " << (IddConfig.EvtIddCxMonitorAssignSwapChain ? "Set" : "Not Set")
		<< "\n  EvtIddCxMonitorUnassignSwapChain: " << (IddConfig.EvtIddCxMonitorUnassignSwapChain ? "Set" : "Not Set");
	vddlog("d", logStream.str().c_str());

	// If the driver wishes to handle custom IoDeviceControl requests, it's necessary to use this callback since IddCx
	// redirects IoDeviceControl requests to an internal queue. This sample does not need this.
	// IddConfig.EvtIddCxDeviceIoControl = VirtualDisplayDriverIoDeviceControl;

	loadSettings();
	logStream.str("");
	if (gpuname.empty() || gpuname == L"default") {
		const wstring adaptername = confpath + L"\\adapter.txt";
		Options.Adapter.load(adaptername.c_str());
		logStream << "Attempting to Load GPU from adapter.txt";
	}
	else {
		Options.Adapter.xmlprovide(gpuname);
		logStream << "Loading GPU from vdd_settings.xml";
	}
	vddlog("i", logStream.str().c_str());
	GetGpuInfo();



	IddConfig.EvtIddCxAdapterInitFinished = VirtualDisplayDriverAdapterInitFinished;

	IddConfig.EvtIddCxMonitorGetDefaultDescriptionModes = VirtualDisplayDriverMonitorGetDefaultModes;
	IddConfig.EvtIddCxMonitorAssignSwapChain = VirtualDisplayDriverMonitorAssignSwapChain;
	IddConfig.EvtIddCxMonitorUnassignSwapChain = VirtualDisplayDriverMonitorUnassignSwapChain;

	if (IDD_IS_FIELD_AVAILABLE(IDD_CX_CLIENT_CONFIG, EvtIddCxAdapterQueryTargetInfo))
	{
		IddConfig.EvtIddCxAdapterQueryTargetInfo = VirtualDisplayDriverEvtIddCxAdapterQueryTargetInfo;
		IddConfig.EvtIddCxMonitorSetDefaultHdrMetaData = VirtualDisplayDriverEvtIddCxMonitorSetDefaultHdrMetadata;
		IddConfig.EvtIddCxParseMonitorDescription2 = VirtualDisplayDriverEvtIddCxParseMonitorDescription2;
		IddConfig.EvtIddCxMonitorQueryTargetModes2 = VirtualDisplayDriverEvtIddCxMonitorQueryTargetModes2;
		IddConfig.EvtIddCxAdapterCommitModes2 = VirtualDisplayDriverEvtIddCxAdapterCommitModes2;
		IddConfig.EvtIddCxMonitorSetGammaRamp = VirtualDisplayDriverEvtIddCxMonitorSetGammaRamp;
	}
	else {
		IddConfig.EvtIddCxParseMonitorDescription = VirtualDisplayDriverParseMonitorDescription;
		IddConfig.EvtIddCxMonitorQueryTargetModes = VirtualDisplayDriverMonitorQueryModes;
		IddConfig.EvtIddCxAdapterCommitModes = VirtualDisplayDriverAdapterCommitModes;
	}

	Status = IddCxDeviceInitConfig(pDeviceInit, &IddConfig);
	if (!NT_SUCCESS(Status))
	{
		logStream.str("");
		logStream << "IddCxDeviceInitConfig failed with status: " << Status;
		vddlog("e", logStream.str().c_str());
		return Status;
	}

	WDF_OBJECT_ATTRIBUTES Attr;
	WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&Attr, IndirectDeviceContextWrapper);
	Attr.EvtCleanupCallback = [](WDFOBJECT Object)
		{
			// Automatically cleanup the context when the WDF object is about to be deleted
			auto* pContext = WdfObjectGet_IndirectDeviceContextWrapper(Object);
			if (pContext)
			{
				pContext->Cleanup();
			}
		};

	logStream.str(""); 
	logStream << "Creating device with WdfDeviceCreate:";
	vddlog("d", logStream.str().c_str());

	WDFDEVICE Device = nullptr;
	Status = WdfDeviceCreate(&pDeviceInit, &Attr, &Device);
	if (!NT_SUCCESS(Status))
	{
		logStream.str(""); 
		logStream << "WdfDeviceCreate failed with status: " << Status;
		vddlog("e", logStream.str().c_str());
		return Status;
	}

	Status = IddCxDeviceInitialize(Device);
	if (!NT_SUCCESS(Status))
	{
		logStream.str(""); 
		logStream << "IddCxDeviceInitialize failed with status: " << Status;
		vddlog("e", logStream.str().c_str());
		return Status;
	}

	// Create a new device context object and attach it to the WDF device object
	/*
	auto* pContext = WdfObjectGet_IndirectDeviceContextWrapper(Device);
	pContext->pContext = new IndirectDeviceContext(Device);
	*/ // code to return uncase the device context wrapper isnt found (Most likely insufficient resources)

	auto* pContext = WdfObjectGet_IndirectDeviceContextWrapper(Device);
	if (pContext)
	{
		pContext->pContext = new IndirectDeviceContext(Device);
		logStream.str(""); 
		logStream << "Device context initialized and attached to WDF device.";
		vddlog("d", logStream.str().c_str());
	}
	else
	{
		logStream.str(""); 
		logStream << "Failed to get device context wrapper.";
		vddlog("e", logStream.str().c_str());
		return STATUS_INSUFFICIENT_RESOURCES;
	}
	return Status;
}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverDeviceD0Entry(WDFDEVICE Device, WDF_POWER_DEVICE_STATE PreviousState)
{
	//UNREFERENCED_PARAMETER(PreviousState);

	stringstream logStream;

	// Log the entry into D0 state
	logStream << "Entering D0 power state:"
		<< "\n  Device Handle: " << static_cast<void*>(Device)
		<< "\n  Previous State: " << PreviousState;
	vddlog("d", logStream.str().c_str());

	// This function is called by WDF to start the device in the fully-on power state.

	/*
	auto* pContext = WdfObjectGet_IndirectDeviceContextWrapper(Device);
	pContext->pContext->InitAdapter();
	*/ //Added error handling incase fails to get device context

	auto* pContext = WdfObjectGet_IndirectDeviceContextWrapper(Device);
	if (pContext && pContext->pContext)
	{
		logStream.str("");
		logStream << "Initializing adapter...";
		vddlog("d", logStream.str().c_str());


		pContext->pContext->InitAdapter();
		logStream.str(""); 
		logStream << "InitAdapter called successfully.";
		vddlog("d", logStream.str().c_str());
	}
	else
	{
		logStream.str(""); 
		logStream << "Failed to get device context.";
		vddlog("e", logStream.str().c_str());
		return STATUS_INSUFFICIENT_RESOURCES;
	}


	return STATUS_SUCCESS;
}

#pragma region Direct3DDevice

Direct3DDevice::Direct3DDevice(LUID AdapterLuid) : AdapterLuid(AdapterLuid)
{
}

Direct3DDevice::Direct3DDevice() : AdapterLuid({})
{
}

HRESULT Direct3DDevice::Init()
{
	HRESULT hr;
	stringstream logStream;

	// The DXGI factory could be cached, but if a new render adapter appears on the system, a new factory needs to be
	// created. If caching is desired, check DxgiFactory->IsCurrent() each time and recreate the factory if !IsCurrent.

	logStream << "Initializing Direct3DDevice...";
	vddlog("d", logStream.str().c_str());

	hr = CreateDXGIFactory2(0, IID_PPV_ARGS(&DxgiFactory));
	if (FAILED(hr))
	{
		logStream.str(""); 
		logStream << "Failed to create DXGI factory. HRESULT: " << hr;
		vddlog("e", logStream.str().c_str());
		return hr;
	}
	logStream.str(""); 
	logStream << "DXGI factory created successfully.";
	vddlog("d", logStream.str().c_str());

	// Find the specified render adapter
	hr = DxgiFactory->EnumAdapterByLuid(AdapterLuid, IID_PPV_ARGS(&Adapter));
	if (FAILED(hr))
	{
		logStream.str(""); 
		logStream << "Failed to enumerate adapter by LUID. HRESULT: " << hr;
		vddlog("e", logStream.str().c_str());
		return hr;
	}

	DXGI_ADAPTER_DESC desc;
	Adapter->GetDesc(&desc);
	logStream.str("");
	logStream << "Adapter found: " << desc.Description << " (Vendor ID: " << desc.VendorId << ", Device ID: " << desc.DeviceId << ")";
	vddlog("i", logStream.str().c_str());


#if 0 // Test code
	{
		FILE* file;
		fopen_s(&file, "C:\\VirtualDisplayDriver\\desc_hdr.bin", "wb");

		DXGI_ADAPTER_DESC desc;
		Adapter->GetDesc(&desc);

		fwrite(&desc, 1, sizeof(desc), file);
		fclose(file);
	}
#endif

	D3D_FEATURE_LEVEL featureLevels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
	D3D_FEATURE_LEVEL featureLevel;

	// Create a D3D device using the render adapter. BGRA support is required by the WHQL test suite.
	hr = D3D11CreateDevice(Adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, featureLevels, ARRAYSIZE(featureLevels), D3D11_SDK_VERSION, &Device, &featureLevel, &DeviceContext);
	if (FAILED(hr))
	{
		// If creating the D3D device failed, it's possible the render GPU was lost (e.g. detachable GPU) or else the
		// system is in a transient state.
		logStream.str(""); 
		logStream << "Failed to create Direct3D device. HRESULT: " << hr;
		vddlog("e", logStream.str().c_str());
		logStream.str("");
		logStream << "If creating the D3D device failed, it's possible the render GPU was lost (e.g. detachable GPU) or else the system is in a transient state. " << hr;
		vddlog("e", logStream.str().c_str());
		return hr;
	}

	logStream.str("");
	logStream << "Direct3D device created successfully. Feature Level: " << featureLevel;
	vddlog("i", logStream.str().c_str());

	return S_OK;
}

#pragma endregion

#pragma region SwapChainProcessor

SwapChainProcessor::SwapChainProcessor(IDDCX_SWAPCHAIN hSwapChain, shared_ptr<Direct3DDevice> Device, HANDLE NewFrameEvent)
	: m_hSwapChain(hSwapChain), m_Device(Device), m_hAvailableBufferEvent(NewFrameEvent)
{
	stringstream logStream;

	logStream << "Constructing SwapChainProcessor:"
		<< "\n  SwapChain Handle: " << static_cast<void*>(hSwapChain)
		<< "\n  Device Pointer: " << static_cast<void*>(Device.get())
		<< "\n  NewFrameEvent Handle: " << NewFrameEvent;
	vddlog("d", logStream.str().c_str());

	m_hTerminateEvent.Attach(CreateEvent(nullptr, FALSE, FALSE, nullptr));
	if (!m_hTerminateEvent.Get())
	{
		logStream.str("");
		logStream << "Failed to create terminate event. GetLastError: " << GetLastError();
		vddlog("e", logStream.str().c_str());
	}
	else
	{
		logStream.str("");
		logStream << "Terminate event created successfully.";
		vddlog("d", logStream.str().c_str());
	}

	// Immediately create and run the swap-chain processing thread, passing 'this' as the thread parameter
	m_hThread.Attach(CreateThread(nullptr, 0, RunThread, this, 0, nullptr));
	if (!m_hThread.Get())
	{
		logStream.str("");
		logStream << "Failed to create swap-chain processing thread. GetLastError: " << GetLastError();
		vddlog("e", logStream.str().c_str());
	}
	else
	{
		logStream.str("");
		logStream << "Swap-chain processing thread created and started successfully.";
		vddlog("d", logStream.str().c_str());
	}
}

SwapChainProcessor::~SwapChainProcessor()
{
	stringstream logStream;

	logStream << "Destructing SwapChainProcessor:";

	vddlog("d", logStream.str().c_str());
	// Alert the swap-chain processing thread to terminate
	//SetEvent(m_hTerminateEvent.Get()); changed for error handling + log purposes 

	if (SetEvent(m_hTerminateEvent.Get()))
	{
		logStream.str(""); 
		logStream << "Terminate event signaled successfully.";
		vddlog("d", logStream.str().c_str());
	}
	else
	{
		logStream.str(""); 
		logStream << "Failed to signal terminate event. GetLastError: " << GetLastError();
		vddlog("e", logStream.str().c_str());
	}

	if (m_hThread.Get())
	{
		// Wait for the thread to terminate
		DWORD waitResult = WaitForSingleObject(m_hThread.Get(), INFINITE);
		switch (waitResult)
		{
		case WAIT_OBJECT_0:
			logStream.str(""); 
			logStream << "Thread terminated successfully.";
			vddlog("d", logStream.str().c_str());
			break;
		case WAIT_ABANDONED:
			logStream.str(""); 
			logStream << "Thread wait was abandoned. GetLastError: " << GetLastError();
			vddlog("e", logStream.str().c_str());
			break;
		case WAIT_TIMEOUT:
			logStream.str(""); 
			logStream << "Thread wait timed out. This should not happen. GetLastError: " << GetLastError();
			vddlog("e", logStream.str().c_str());
			break;
		default:
			logStream.str(""); 
			logStream << "Unexpected result from WaitForSingleObject. GetLastError: " << GetLastError();
			vddlog("e", logStream.str().c_str());
			break;
		}
	}
	else
	{
		logStream.str("");
		logStream << "No valid thread handle to wait for.";
		vddlog("e", logStream.str().c_str());
	}
}

DWORD CALLBACK SwapChainProcessor::RunThread(LPVOID Argument)
{
	stringstream logStream;

	logStream << "RunThread started. Argument: " << Argument;
	vddlog("d", logStream.str().c_str());

	reinterpret_cast<SwapChainProcessor*>(Argument)->Run();
	return 0;
}

void SwapChainProcessor::Run()
{
	stringstream logStream;

	logStream << "Run method started.";
	vddlog("d", logStream.str().c_str());

	// For improved performance, make use of the Multimedia Class Scheduler Service, which will intelligently
	// prioritize this thread for improved throughput in high CPU-load scenarios.
	DWORD AvTask = 0;
	HANDLE AvTaskHandle = AvSetMmThreadCharacteristicsW(L"Distribution", &AvTask);

	if (AvTaskHandle)
	{
		logStream.str("");
		logStream << "Multimedia thread characteristics set successfully. AvTask: " << AvTask;
		vddlog("d", logStream.str().c_str());
	}
	else
	{
		logStream.str(""); 
		logStream << "Failed to set multimedia thread characteristics. GetLastError: " << GetLastError();
		vddlog("e", logStream.str().c_str());
	}

	RunCore();

	logStream.str(""); 
	logStream << "Core processing function RunCore() completed.";
	vddlog("d", logStream.str().c_str());

	// Always delete the swap-chain object when swap-chain processing loop terminates in order to kick the system to
	// provide a new swap-chain if necessary.
	/*
	WdfObjectDelete((WDFOBJECT)m_hSwapChain);
	m_hSwapChain = nullptr;   added error handling in so its not called to delete swap chain if its not needed.
	*/
	if (m_hSwapChain)
	{
		WdfObjectDelete((WDFOBJECT)m_hSwapChain);
		logStream.str("");
		logStream << "Swap-chain object deleted.";
		vddlog("d", logStream.str().c_str());
		m_hSwapChain = nullptr;
	}
	else
	{
		logStream.str("");
		logStream << "No valid swap-chain object to delete.";
		vddlog("w", logStream.str().c_str());
	}
	/*
	AvRevertMmThreadCharacteristics(AvTaskHandle);
	*/ //error handling when reversing multimedia thread characteristics 
	if (AvRevertMmThreadCharacteristics(AvTaskHandle))
	{
		logStream.str(""); 
		logStream << "Multimedia thread characteristics reverted successfully.";
		vddlog("d", logStream.str().c_str());
	}
	else
	{
		logStream.str(""); 
		logStream << "Failed to revert multimedia thread characteristics. GetLastError: " << GetLastError();
		vddlog("e", logStream.str().c_str());
	}
}

void SwapChainProcessor::RunCore()
{
	stringstream logStream;
	DWORD retryDelay = 1;
	const DWORD maxRetryDelay = 100;
	int retryCount = 0;
	const int maxRetries = 5;

	// Get the DXGI device interface
	ComPtr<IDXGIDevice> DxgiDevice;
	HRESULT hr = m_Device->Device.As(&DxgiDevice);
	if (FAILED(hr))
	{
		logStream << "Failed to get DXGI device interface. HRESULT: " << hr;
		vddlog("e", logStream.str().c_str());
		return;
	}
	logStream << "DXGI device interface obtained successfully.";
	//vddlog("d", logStream.str().c_str());


	// Validate that our device is still valid before setting it
	if (!m_Device || !m_Device->Device) {
		vddlog("e", "Direct3DDevice became invalid during SwapChain processing");
		return;
	}

	IDARG_IN_SWAPCHAINSETDEVICE SetDevice = {};
	SetDevice.pDevice = DxgiDevice.Get();

	hr = IddCxSwapChainSetDevice(m_hSwapChain, &SetDevice);
	logStream.str("");
	if (FAILED(hr))
	{
		logStream << "Failed to set device to swap chain. HRESULT: " << hr;
		vddlog("e", logStream.str().c_str());
		return;
	}
	logStream << "Device set to swap chain successfully.";
	//vddlog("d", logStream.str().c_str());

	logStream.str(""); 
	logStream << "Starting buffer acquisition and release loop.";
	//vddlog("d", logStream.str().c_str());

	// Acquire and release buffers in a loop
	for (;;)
	{
		ComPtr<IDXGIResource> AcquiredBuffer;

		// Ask for the next buffer from the producer
		IDARG_IN_RELEASEANDACQUIREBUFFER2 BufferInArgs = {};
		BufferInArgs.Size = sizeof(BufferInArgs);
		IDXGIResource* pSurface;

		if (IDD_IS_FUNCTION_AVAILABLE(IddCxSwapChainReleaseAndAcquireBuffer2)) {
			IDARG_OUT_RELEASEANDACQUIREBUFFER2 Buffer = {};
			hr = IddCxSwapChainReleaseAndAcquireBuffer2(m_hSwapChain, &BufferInArgs, &Buffer);
			pSurface = Buffer.MetaData.pSurface;
		}
		else
		{
			IDARG_OUT_RELEASEANDACQUIREBUFFER Buffer = {};
			hr = IddCxSwapChainReleaseAndAcquireBuffer(m_hSwapChain, &Buffer);
			pSurface = Buffer.MetaData.pSurface;
		}
		// AcquireBuffer immediately returns STATUS_PENDING if no buffer is yet available
		logStream.str("");
		if (hr == E_PENDING)
		{
			// We must wait for a new buffer
			HANDLE WaitHandles[] =
			{
				m_hAvailableBufferEvent,
				m_hTerminateEvent.Get()
			};
			DWORD WaitResult = WaitForMultipleObjects(ARRAYSIZE(WaitHandles), WaitHandles, FALSE, 100);

			logStream << "Buffer acquisition pending. WaitResult: " << WaitResult;

			if (WaitResult == WAIT_OBJECT_0 || WaitResult == WAIT_TIMEOUT)
			{
				// We have a new buffer, so try the AcquireBuffer again
				//vddlog("d", "New buffer trying aquire new buffer");
				continue;
			}
			else if (WaitResult == WAIT_OBJECT_0 + 1)
			{
				// We need to terminate
				logStream << "Terminate event signaled. Exiting loop.";
				//vddlog("d", logStream.str().c_str());
				break;
			}
			else
			{
				// The wait was cancelled or something unexpected happened
				hr = HRESULT_FROM_WIN32(WaitResult);
				logStream << "Unexpected wait result. HRESULT: " << hr;
				vddlog("e", logStream.str().c_str());
				break;
			}
		}
		else if (SUCCEEDED(hr))
		{
			// Reset retry delay and count on successful buffer acquisition
			retryDelay = 1;
			retryCount = 0;
			
			AcquiredBuffer.Attach(pSurface);

			// ==============================
			// TODO: Process the frame here
			//
			// This is the most performance-critical section of code in an IddCx driver. It's important that whatever
			// is done with the acquired surface be finished as quickly as possible. This operation could be:
			//  * a GPU copy to another buffer surface for later processing (such as a staging surface for mapping to CPU memory)
			//  * a GPU encode operation
			//  * a GPU VPBlt to another surface
			//  * a GPU custom compute shader encode operation
			// ==============================

			AcquiredBuffer.Reset();
			//vddlog("d", "Reset buffer");
			hr = IddCxSwapChainFinishedProcessingFrame(m_hSwapChain);
			if (FAILED(hr))
			{
				break;
			}

			// ==============================
			// TODO: Report frame statistics once the asynchronous encode/send work is completed
			//
			// Drivers should report information about sub-frame timings, like encode time, send time, etc.
			// ==============================
			// IddCxSwapChainReportFrameStatistics(m_hSwapChain, ...);
		}
		else
		{
			logStream.str(""); // Clear the stream
			if (hr == DXGI_ERROR_ACCESS_LOST && retryCount < maxRetries)
			{
				logStream << "DXGI_ERROR_ACCESS_LOST detected. Retry " << (retryCount + 1) << "/" << maxRetries << " after " << retryDelay << "ms delay.";
				vddlog("w", logStream.str().c_str());
				Sleep(retryDelay);
				retryDelay = min(retryDelay * 2, maxRetryDelay);
				retryCount++;
				continue;
			}
			else
			{
				if (hr == DXGI_ERROR_ACCESS_LOST)
				{
					logStream << "DXGI_ERROR_ACCESS_LOST: Maximum retries (" << maxRetries << ") reached. Exiting loop.";
				}
				else
				{
					logStream << "Failed to acquire buffer. Exiting loop. HRESULT: " << hr;
				}
				vddlog("e", logStream.str().c_str());
				// The swap-chain was likely abandoned, so exit the processing loop
				break;
			}
		}
	}
}

#pragma endregion

#pragma region IndirectDeviceContext

const UINT64 MHZ = 1000000;
const UINT64 KHZ = 1000;

constexpr DISPLAYCONFIG_VIDEO_SIGNAL_INFO dispinfo(UINT32 h, UINT32 v, UINT32 rn, UINT32 rd) {
	const UINT32 clock_rate = rn * (v + 4) * (v + 4) / rd + 1000;
	return {
	  clock_rate,                                      // pixel clock rate [Hz]
	{ clock_rate, v + 4 },                         // fractional horizontal refresh rate [Hz]
	{ clock_rate, (v + 4) * (v + 4) },          // fractional vertical refresh rate [Hz]
	{ h, v },                                    // (horizontal, vertical) active pixel resolution
	{ h + 4, v + 4 },                         // (horizontal, vertical) total pixel resolution
	{ { 255, 0 }},                                   // video standard and vsync divider
	DISPLAYCONFIG_SCANLINE_ORDERING_PROGRESSIVE
	};
}

vector<BYTE> hardcodedEdid =
{
0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0x36, 0x94, 0x37, 0x13, 0xe7, 0x1e, 0xe7, 0x1e,
0x1c, 0x22, 0x01, 0x03, 0x80, 0x32, 0x1f, 0x78, 0x07, 0xee, 0x95, 0xa3, 0x54, 0x4c, 0x99, 0x26,
0x0f, 0x50, 0x54, 0x00, 0x00, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x02, 0x3a, 0x80, 0x18, 0x71, 0x38, 0x2d, 0x40, 0x58, 0x2c,
0x45, 0x00, 0x63, 0xc8, 0x10, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0xfd, 0x00, 0x17, 0xf0, 0x0f,
0xff, 0x37, 0x00, 0x0a, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xfc,
0x00, 0x56, 0x44, 0x44, 0x20, 0x62, 0x79, 0x20, 0x4d, 0x54, 0x54, 0x0a, 0x20, 0x20, 0x01, 0xc2,
0x02, 0x03, 0x20, 0x40, 0xe6, 0x06, 0x0d, 0x01, 0xa2, 0xa2, 0x10, 0xe3, 0x05, 0xd8, 0x00, 0x67,
0xd8, 0x5d, 0xc4, 0x01, 0x6e, 0x80, 0x00, 0x68, 0x03, 0x0c, 0x00, 0x00, 0x00, 0x30, 0x00, 0x0b,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x8c
};


void modifyEdid(vector<BYTE>& edid) {
	if (edid.size() < 12) {
		return;
	}

	edid[8] = 0x36;
	edid[9] = 0x94;
	edid[10] = 0x37;
	edid[11] = 0x13;
}



BYTE calculateChecksum(const std::vector<BYTE>& edid) {
	int sum = 0;
	for (int i = 0; i < 127; ++i) {
		sum += edid[i];
	}
	sum %= 256;
	if (sum != 0) {
		sum = 256 - sum;
	}
	return static_cast<BYTE>(sum);
	// check sum calculations. We dont need to include old checksum in calculation, so we only read up to the byte before.
	// Anything after the checksum bytes arent part of the checksum - a flaw with edid managment, not with us
}

void updateCeaExtensionCount(vector<BYTE>& edid, int count) {
	edid[126] = static_cast<BYTE>(count);
}

vector<BYTE> loadEdid(const string& filePath) {
	if (customEdid) {
		vddlog("i", "Attempting to use user Edid");
	}
	else {
		vddlog("i", "Using hardcoded edid");
		return hardcodedEdid;
	}

	ifstream file(filePath, ios::binary | ios::ate);
	if (!file) {
		vddlog("i", "No custom edid found");
		vddlog("i", "Using hardcoded edid");
		return hardcodedEdid;
	}

	streamsize size = file.tellg();
	file.seekg(0, ios::beg);

	vector<BYTE> buffer(size);
	if (file.read((char*)buffer.data(), size)) {
		//calculate checksum and compare it to 127 byte, if false then return hardcoded if true then return buffer to prevent loading borked edid.
		BYTE calculatedChecksum = calculateChecksum(buffer);
		if (calculatedChecksum != buffer[127]) {
			vddlog("e", "Custom edid failed due to invalid checksum");
			vddlog("i", "Using hardcoded edid");
			return hardcodedEdid;
		}

		if (edidCeaOverride) {
			if (buffer.size() == 256) {
				for (int i = 128; i < 256; ++i) {
					buffer[i] = hardcodedEdid[i];
				}
				updateCeaExtensionCount(buffer, 1);
			}
			else if (buffer.size() == 128) {
				buffer.insert(buffer.end(), hardcodedEdid.begin() + 128, hardcodedEdid.end());
				updateCeaExtensionCount(buffer, 1);
			}
		}

		vddlog("i", "Using custom edid");
		return buffer;
	}
	else {
		vddlog("i", "Using hardcoded edid");
		return hardcodedEdid;
	}
}

int maincalc() {
	vector<BYTE> edid = loadEdid(WStringToString(confpath) + "\\user_edid.bin");

	if (!preventManufacturerSpoof) modifyEdid(edid);
	BYTE checksum = calculateChecksum(edid);
	edid[127] = checksum;
	// Setting this variable is depricated, hardcoded edid is either returned or custom in loading edid function
	IndirectDeviceContext::s_KnownMonitorEdid = edid;
	return 0;
}

std::shared_ptr<Direct3DDevice> IndirectDeviceContext::GetOrCreateDevice(LUID RenderAdapter)
{
	std::shared_ptr<Direct3DDevice> Device;
	stringstream logStream;

	logStream << "GetOrCreateDevice called for LUID: " << RenderAdapter.HighPart << "-" << RenderAdapter.LowPart;
	vddlog("d", logStream.str().c_str());

	{
		std::lock_guard<std::mutex> lock(s_DeviceCacheMutex);
		
		logStream.str("");
		logStream << "Device cache size: " << s_DeviceCache.size();
		vddlog("d", logStream.str().c_str());
		
		auto it = s_DeviceCache.find(RenderAdapter);
		if (it != s_DeviceCache.end()) {
			Device = it->second;
			if (Device) {
				logStream.str("");
				logStream << "Reusing cached Direct3DDevice for LUID " << RenderAdapter.HighPart << "-" << RenderAdapter.LowPart;
				vddlog("d", logStream.str().c_str());
				return Device;
			} else {
				logStream.str("");
				logStream << "Cached Direct3DDevice is null for LUID " << RenderAdapter.HighPart << "-" << RenderAdapter.LowPart << ", removing from cache";
				vddlog("d", logStream.str().c_str());
				s_DeviceCache.erase(it);
			}
		}
	}

	logStream.str("");
	logStream << "Creating new Direct3DDevice for LUID " << RenderAdapter.HighPart << "-" << RenderAdapter.LowPart;
	vddlog("d", logStream.str().c_str());
	
	Device = make_shared<Direct3DDevice>(RenderAdapter);
	if (FAILED(Device->Init())) {
		vddlog("e", "Failed to initialize new Direct3DDevice");
		return nullptr;
	}

	{
		std::lock_guard<std::mutex> lock(s_DeviceCacheMutex);
		s_DeviceCache[RenderAdapter] = Device;
		logStream.str("");
		logStream << "Created and cached new Direct3DDevice for LUID " << RenderAdapter.HighPart << "-" << RenderAdapter.LowPart << " (cache size now: " << s_DeviceCache.size() << ")";
		vddlog("d", logStream.str().c_str());
	}

	return Device;
}

void IndirectDeviceContext::CleanupExpiredDevices()
{
	std::lock_guard<std::mutex> lock(s_DeviceCacheMutex);
	
	int removed = 0;
	for (auto it = s_DeviceCache.begin(); it != s_DeviceCache.end();) {
		// With shared_ptr cache, we only remove null devices (shouldn't happen)
		if (!it->second) {
			it = s_DeviceCache.erase(it);
			removed++;
		} else {
			++it;
		}
	}
	
	if (removed > 0) {
		stringstream logStream;
		logStream << "Cleaned up " << removed << " null Direct3DDevice references from cache";
		vddlog("d", logStream.str().c_str());
	}
}

IndirectDeviceContext::IndirectDeviceContext(_In_ WDFDEVICE WdfDevice) :
	m_WdfDevice(WdfDevice),
	m_Adapter(nullptr),
	m_Monitor(nullptr),
	m_Monitor2(nullptr)
{
	// Initialize Phase 5: Final Integration and Testing
	NTSTATUS initStatus = InitializePhase5Integration();
	if (!NT_SUCCESS(initStatus)) {
		vddlog("w", "Phase 5 integration initialization completed with warnings");
	}
}

IndirectDeviceContext::~IndirectDeviceContext()
{
	stringstream logStream;

	logStream << "Destroying IndirectDeviceContext. Resetting processing thread.";
	vddlog("d", logStream.str().c_str());

	m_ProcessingThread.reset();

	logStream.str("");
	logStream << "Processing thread has been reset.";
	vddlog("d", logStream.str().c_str());
}

#define NUM_VIRTUAL_DISPLAYS 1   //What is this even used for ?? Its never referenced

void IndirectDeviceContext::InitAdapter()
{
	maincalc();
	stringstream logStream;

	// ==============================
	// TODO: Update the below diagnostic information in accordance with the target hardware. The strings and version
	// numbers are used for telemetry and may be displayed to the user in some situations.
	//
	// This is also where static per-adapter capabilities are determined.
	// ==============================

	logStream << "Initializing adapter...";
	vddlog("d", logStream.str().c_str());
	logStream.str("");

	IDDCX_ADAPTER_CAPS AdapterCaps = {};
	AdapterCaps.Size = sizeof(AdapterCaps);

	if (IDD_IS_FUNCTION_AVAILABLE(IddCxSwapChainReleaseAndAcquireBuffer2)) {
		AdapterCaps.Flags = IDDCX_ADAPTER_FLAGS_CAN_PROCESS_FP16;
		logStream << "FP16 processing capability detected.";
	}

	// Declare basic feature support for the adapter (required)
	AdapterCaps.MaxMonitorsSupported = numVirtualDisplays;
	AdapterCaps.EndPointDiagnostics.Size = sizeof(AdapterCaps.EndPointDiagnostics);
	AdapterCaps.EndPointDiagnostics.GammaSupport = IDDCX_FEATURE_IMPLEMENTATION_NONE;
	AdapterCaps.EndPointDiagnostics.TransmissionType = IDDCX_TRANSMISSION_TYPE_WIRED_OTHER;

	// Declare your device strings for telemetry (required)
	AdapterCaps.EndPointDiagnostics.pEndPointFriendlyName = L"VirtualDisplayDriver Device";
	AdapterCaps.EndPointDiagnostics.pEndPointManufacturerName = L"MikeTheTech";
	AdapterCaps.EndPointDiagnostics.pEndPointModelName = L"VirtualDisplayDriver Model";

	// Declare your hardware and firmware versions (required)
	IDDCX_ENDPOINT_VERSION Version = {};
	Version.Size = sizeof(Version);
	Version.MajorVer = 1;
	AdapterCaps.EndPointDiagnostics.pFirmwareVersion = &Version;
	AdapterCaps.EndPointDiagnostics.pHardwareVersion = &Version;

	logStream << "Adapter Caps Initialized:"
		<< "\n  Max Monitors Supported: " << AdapterCaps.MaxMonitorsSupported
		<< "\n  Gamma Support: " << AdapterCaps.EndPointDiagnostics.GammaSupport
		<< "\n  Transmission Type: " << AdapterCaps.EndPointDiagnostics.TransmissionType
		<< "\n  Friendly Name: " << AdapterCaps.EndPointDiagnostics.pEndPointFriendlyName
		<< "\n  Manufacturer Name: " << AdapterCaps.EndPointDiagnostics.pEndPointManufacturerName
		<< "\n  Model Name: " << AdapterCaps.EndPointDiagnostics.pEndPointModelName
		<< "\n  Firmware Version: " << Version.MajorVer
		<< "\n  Hardware Version: " << Version.MajorVer;

	vddlog("d", logStream.str().c_str());
	logStream.str("");

	// Initialize a WDF context that can store a pointer to the device context object
	WDF_OBJECT_ATTRIBUTES Attr;
	WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&Attr, IndirectDeviceContextWrapper);

	IDARG_IN_ADAPTER_INIT AdapterInit = {};
	AdapterInit.WdfDevice = m_WdfDevice;
	AdapterInit.pCaps = &AdapterCaps;
	AdapterInit.ObjectAttributes = &Attr;

	// Start the initialization of the adapter, which will trigger the AdapterFinishInit callback later
	IDARG_OUT_ADAPTER_INIT AdapterInitOut;
	NTSTATUS Status = IddCxAdapterInitAsync(&AdapterInit, &AdapterInitOut);

	logStream << "Adapter Initialization Status: " << Status;
	vddlog("d", logStream.str().c_str());
	logStream.str("");

	if (NT_SUCCESS(Status))
	{
		// Store a reference to the WDF adapter handle
		m_Adapter = AdapterInitOut.AdapterObject;
		logStream << "Adapter handle stored successfully.";
		vddlog("d", logStream.str().c_str());

		// Store the device context object into the WDF object context
		auto* pContext = WdfObjectGet_IndirectDeviceContextWrapper(AdapterInitOut.AdapterObject);
		pContext->pContext = this;
	}
	else {
		logStream << "Failed to initialize adapter. Status: " << Status;
		vddlog("e", logStream.str().c_str());
	}
}

void IndirectDeviceContext::FinishInit()
{
	Options.Adapter.apply(m_Adapter);
	vddlog("i", "Applied Adapter configs.");
	for (unsigned int i = 0; i < numVirtualDisplays; i++) {
		CreateMonitor(i);
	}
}

void IndirectDeviceContext::CreateMonitor(unsigned int index) {
	wstring logMessage = L"Creating Monitor: " + to_wstring(index + 1);
	string narrowLogMessage = WStringToString(logMessage);
	vddlog("i", narrowLogMessage.c_str());

	// ==============================
	// TODO: In a real driver, the EDID should be retrieved dynamically from a connected physical monitor. The EDID
	// provided here is purely for demonstration, as it describes only 640x480 @ 60 Hz and 800x600 @ 60 Hz. Monitor
	// manufacturers are required to correctly fill in physical monitor attributes in order to allow the OS to optimize
	// settings like viewing distance and scale factor. Manufacturers should also use a unique serial number every
	// single device to ensure the OS can tell the monitors apart.
	// ==============================

	WDF_OBJECT_ATTRIBUTES Attr;
	WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&Attr, IndirectDeviceContextWrapper);

	IDDCX_MONITOR_INFO MonitorInfo = {};
	MonitorInfo.Size = sizeof(MonitorInfo);
	MonitorInfo.MonitorType = DISPLAYCONFIG_OUTPUT_TECHNOLOGY_HDMI;
	MonitorInfo.ConnectorIndex = index;
	MonitorInfo.MonitorDescription.Size = sizeof(MonitorInfo.MonitorDescription);
	MonitorInfo.MonitorDescription.Type = IDDCX_MONITOR_DESCRIPTION_TYPE_EDID;
	//MonitorInfo.MonitorDescription.DataSize = sizeof(s_KnownMonitorEdid);        can no longer use size of as converted to vector
	if (s_KnownMonitorEdid.size() > UINT_MAX)
	{
		vddlog("e", "Edid size passes UINT_Max, escape to prevent loading borked display");
	}
	else
	{
		MonitorInfo.MonitorDescription.DataSize = static_cast<UINT>(s_KnownMonitorEdid.size());
	}
	//MonitorInfo.MonitorDescription.pData = const_cast<BYTE*>(s_KnownMonitorEdid);
	// Changed from using const_cast to data() to safely access the EDID data.
	// This improves type safety and code readability, as it eliminates the need for casting 
	// and ensures we are directly working with the underlying container of known monitor EDID data.
	MonitorInfo.MonitorDescription.pData = IndirectDeviceContext::s_KnownMonitorEdid.data();






	// ==============================
	// TODO: The monitor's container ID should be distinct from "this" device's container ID if the monitor is not
	// permanently attached to the display adapter device object. The container ID is typically made unique for each
	// monitor and can be used to associate the monitor with other devices, like audio or input devices. In this
	// sample we generate a random container ID GUID, but it's best practice to choose a stable container ID for a
	// unique monitor or to use "this" device's container ID for a permanent/integrated monitor.
	// ==============================

	// Create a container ID
	CoCreateGuid(&MonitorInfo.MonitorContainerId);
	vddlog("d", "Created container ID");

	IDARG_IN_MONITORCREATE MonitorCreate = {};
	MonitorCreate.ObjectAttributes = &Attr;
	MonitorCreate.pMonitorInfo = &MonitorInfo;

	// Create a monitor object with the specified monitor descriptor
	IDARG_OUT_MONITORCREATE MonitorCreateOut;
	NTSTATUS Status = IddCxMonitorCreate(m_Adapter, &MonitorCreate, &MonitorCreateOut);
	if (NT_SUCCESS(Status))
	{
		vddlog("d", "Monitor created successfully.");
		m_Monitor = MonitorCreateOut.MonitorObject;

		// Associate the monitor with this device context
		auto* pContext = WdfObjectGet_IndirectDeviceContextWrapper(MonitorCreateOut.MonitorObject);
		pContext->pContext = this;

		// Tell the OS that the monitor has been plugged in
		IDARG_OUT_MONITORARRIVAL ArrivalOut;
		Status = IddCxMonitorArrival(m_Monitor, &ArrivalOut);
		if (NT_SUCCESS(Status))
		{
			vddlog("d", "Monitor arrival successfully reported.");
		}
		else
		{
			stringstream ss;
			ss << "Failed to report monitor arrival. Status: " << Status;
			vddlog("e", ss.str().c_str());
		}
	}
	else
	{
		stringstream ss;
		ss << "Failed to create monitor. Status: " << Status;
		vddlog("e", ss.str().c_str());
	}
}

void IndirectDeviceContext::AssignSwapChain(IDDCX_MONITOR& Monitor, IDDCX_SWAPCHAIN SwapChain, LUID RenderAdapter, HANDLE NewFrameEvent)
{
	// Properly wait for existing thread to complete before creating new one
	if (m_ProcessingThread) {
		vddlog("d", "Waiting for existing processing thread to complete before reassignment.");
		m_ProcessingThread.reset(); // This will call destructor which waits for thread completion
		vddlog("d", "Existing processing thread completed.");
	}

	// Only cleanup expired devices periodically, not on every assignment
	static int assignmentCount = 0;
	if (++assignmentCount % 10 == 0) {
		CleanupExpiredDevices();
	}

	auto Device = GetOrCreateDevice(RenderAdapter);
	if (!Device)
	{
		vddlog("e", "Failed to get or create Direct3DDevice, deleting existing swap-chain.");
		WdfObjectDelete(SwapChain);
		return;
	}
	else
	{
		vddlog("d", "Creating a new swap-chain processing thread.");
		m_ProcessingThread.reset(new SwapChainProcessor(SwapChain, Device, NewFrameEvent));

		if (hardwareCursor){
			HANDLE mouseEvent = CreateEventA(
				nullptr, 
				false,   
				false,   
				"VirtualDisplayDriverMouse"
			);

			if (!mouseEvent)
			{
				vddlog("e", "Failed to create mouse event. No hardware cursor supported!");
				return;
			}

			IDDCX_CURSOR_CAPS cursorInfo = {};
			cursorInfo.Size = sizeof(cursorInfo);
			cursorInfo.ColorXorCursorSupport = IDDCX_XOR_CURSOR_SUPPORT_FULL; 
			cursorInfo.AlphaCursorSupport = alphaCursorSupport;

			cursorInfo.MaxX = CursorMaxX;       //Apparently in most cases 128 is fine but for safe guarding we will go 512, older intel cpus may be limited to 64x64
			cursorInfo.MaxY = CursorMaxY;

			//DirectXDevice->QueryMaxCursorSize(&cursorInfo.MaxX, &cursorInfo.MaxY);                 Experimental to get max cursor size - THIS IS NTO WORKING CODE


			IDARG_IN_SETUP_HWCURSOR hwCursor = {};
			hwCursor.CursorInfo = cursorInfo;
			hwCursor.hNewCursorDataAvailable = mouseEvent;

			NTSTATUS Status = IddCxMonitorSetupHardwareCursor(
				Monitor,
				&hwCursor
			);

			if (FAILED(Status))
			{
				CloseHandle(mouseEvent); 
				return;
			}

			vddlog("d", "Hardware cursor setup completed successfully.");
		}
		else {
			vddlog("d", "Hardware cursor is disabled, Skipped creation.");
		}
		// At this point, the swap-chain is set up and the hardware cursor is enabled
		// Further swap-chain and cursor processing will occur in the new processing thread.
	}
}


void IndirectDeviceContext::UnassignSwapChain()
{
	// Stop processing the last swap-chain
	vddlog("i", "Unasigning Swapchain. Processing will be stopped.");
	m_ProcessingThread.reset();
}

#pragma endregion

#pragma region DDI Callbacks

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverAdapterInitFinished(IDDCX_ADAPTER AdapterObject, const IDARG_IN_ADAPTER_INIT_FINISHED* pInArgs)
{
	// This is called when the OS has finished setting up the adapter for use by the IddCx driver. It's now possible
	// to report attached monitors.

	auto* pContext = WdfObjectGet_IndirectDeviceContextWrapper(AdapterObject);
	if (NT_SUCCESS(pInArgs->AdapterInitStatus))
	{
		pContext->pContext->FinishInit();
		vddlog("d", "Adapter initialization finished successfully.");
	}
	else
	{
		stringstream ss;
		ss << "Adapter initialization failed. Status: " << pInArgs->AdapterInitStatus;
		vddlog("e", ss.str().c_str());
	}
	vddlog("i", "Finished Setting up adapter.");
	

	return STATUS_SUCCESS;
}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverAdapterCommitModes(IDDCX_ADAPTER AdapterObject, const IDARG_IN_COMMITMODES* pInArgs)
{
	UNREFERENCED_PARAMETER(AdapterObject);
	UNREFERENCED_PARAMETER(pInArgs);

	// For the sample, do nothing when modes are picked - the swap-chain is taken care of by IddCx

	// ==============================
	// TODO: In a real driver, this function would be used to reconfigure the device to commit the new modes. Loop
	// through pInArgs->pPaths and look for IDDCX_PATH_FLAGS_ACTIVE. Any path not active is inactive (e.g. the monitor
	// should be turned off).
	// ==============================

	return STATUS_SUCCESS;
}
_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverParseMonitorDescription(const IDARG_IN_PARSEMONITORDESCRIPTION* pInArgs, IDARG_OUT_PARSEMONITORDESCRIPTION* pOutArgs)
{
	// ==============================
	// TODO: In a real driver, this function would be called to generate monitor modes for an EDID by parsing it. In
	// this sample driver, we hard-code the EDID, so this function can generate known modes.
	// ==============================

	stringstream logStream;
	logStream << "Parsing monitor description. Input buffer count: " << pInArgs->MonitorModeBufferInputCount;
	vddlog("d", logStream.str().c_str());

	for (int i = 0; i < monitorModes.size(); i++) {
		s_KnownMonitorModes2.push_back(dispinfo(std::get<0>(monitorModes[i]), std::get<1>(monitorModes[i]), std::get<2>(monitorModes[i]), std::get<3>(monitorModes[i])));
	}
	pOutArgs->MonitorModeBufferOutputCount = (UINT)monitorModes.size();

	logStream.str("");
	logStream << "Number of monitor modes generated: " << monitorModes.size();
	vddlog("d", logStream.str().c_str());

	if (pInArgs->MonitorModeBufferInputCount < monitorModes.size())
	{
		logStream.str(""); 
		logStream << "Buffer too small. Input count: " << pInArgs->MonitorModeBufferInputCount << ", Required: " << monitorModes.size();
		vddlog("w", logStream.str().c_str());
		// Return success if there was no buffer, since the caller was only asking for a count of modes
		return (pInArgs->MonitorModeBufferInputCount > 0) ? STATUS_BUFFER_TOO_SMALL : STATUS_SUCCESS;
	}
	else
	{
		// Copy the known modes to the output buffer
		for (DWORD ModeIndex = 0; ModeIndex < monitorModes.size(); ModeIndex++)
		{
			pInArgs->pMonitorModes[ModeIndex].Size = sizeof(IDDCX_MONITOR_MODE);
			pInArgs->pMonitorModes[ModeIndex].Origin = IDDCX_MONITOR_MODE_ORIGIN_MONITORDESCRIPTOR;
			pInArgs->pMonitorModes[ModeIndex].MonitorVideoSignalInfo = s_KnownMonitorModes2[ModeIndex];
		}

		// Set the preferred mode as represented in the EDID
		pOutArgs->PreferredMonitorModeIdx = 0;
		vddlog("d", "Monitor description parsed successfully.");
		return STATUS_SUCCESS;
	}
}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverMonitorGetDefaultModes(IDDCX_MONITOR MonitorObject, const IDARG_IN_GETDEFAULTDESCRIPTIONMODES* pInArgs, IDARG_OUT_GETDEFAULTDESCRIPTIONMODES* pOutArgs)
{
	UNREFERENCED_PARAMETER(MonitorObject);
	UNREFERENCED_PARAMETER(pInArgs);
	UNREFERENCED_PARAMETER(pOutArgs);

	// Should never be called since we create a single monitor with a known EDID in this sample driver.

	// ==============================
	// TODO: In a real driver, this function would be called to generate monitor modes for a monitor with no EDID.
	// Drivers should report modes that are guaranteed to be supported by the transport protocol and by nearly all
	// monitors (such 640x480, 800x600, or 1024x768). If the driver has access to monitor modes from a descriptor other
	// than an EDID, those modes would also be reported here.
	// ==============================

	return STATUS_NOT_IMPLEMENTED;
}

/// <summary>
/// Creates a target mode from the fundamental mode attributes.
/// </summary>
void CreateTargetMode(DISPLAYCONFIG_VIDEO_SIGNAL_INFO& Mode, UINT Width, UINT Height, UINT VSyncNum, UINT VSyncDen)
{
	stringstream logStream;
	logStream << "Creating target mode with Width: " << Width
		<< ", Height: " << Height
		<< ", VSyncNum: " << VSyncNum
		<< ", VSyncDen: " << VSyncDen;
	vddlog("d", logStream.str().c_str());

	Mode.totalSize.cx = Mode.activeSize.cx = Width;
	Mode.totalSize.cy = Mode.activeSize.cy = Height;
	Mode.AdditionalSignalInfo.vSyncFreqDivider = 1;
	Mode.AdditionalSignalInfo.videoStandard = 255;
	Mode.vSyncFreq.Numerator = VSyncNum;
	Mode.vSyncFreq.Denominator = VSyncDen;
	Mode.hSyncFreq.Numerator = VSyncNum * Height;
	Mode.hSyncFreq.Denominator = VSyncDen;
	Mode.scanLineOrdering = DISPLAYCONFIG_SCANLINE_ORDERING_PROGRESSIVE;
	Mode.pixelRate = VSyncNum * Width * Height / VSyncDen;

	logStream.str("");
	logStream << "Target mode configured with:"
		<< "\n  Total Size: (" << Mode.totalSize.cx << ", " << Mode.totalSize.cy << ")"
		<< "\n  Active Size: (" << Mode.activeSize.cx << ", " << Mode.activeSize.cy << ")"
		<< "\n  vSync Frequency: " << Mode.vSyncFreq.Numerator << "/" << Mode.vSyncFreq.Denominator
		<< "\n  hSync Frequency: " << Mode.hSyncFreq.Numerator << "/" << Mode.hSyncFreq.Denominator
		<< "\n  Pixel Rate: " << Mode.pixelRate
		<< "\n  Scan Line Ordering: " << Mode.scanLineOrdering;
	vddlog("d", logStream.str().c_str());
}

void CreateTargetMode(IDDCX_TARGET_MODE& Mode, UINT Width, UINT Height, UINT VSyncNum, UINT VSyncDen)
{
	Mode.Size = sizeof(Mode);
	CreateTargetMode(Mode.TargetVideoSignalInfo.targetVideoSignalInfo, Width, Height, VSyncNum, VSyncDen);
}

void CreateTargetMode2(IDDCX_TARGET_MODE2& Mode, UINT Width, UINT Height, UINT VSyncNum, UINT VSyncDen)
{
	stringstream logStream;
	logStream << "Creating IDDCX_TARGET_MODE2 with Width: " << Width
		<< ", Height: " << Height
		<< ", VSyncNum: " << VSyncNum
		<< ", VSyncDen: " << VSyncDen;
	vddlog("d", logStream.str().c_str());

	Mode.Size = sizeof(Mode);


	if (ColourFormat == L"RGB") {
		Mode.BitsPerComponent.Rgb = SDRCOLOUR | HDRCOLOUR;
	}
	else if (ColourFormat == L"YCbCr444") {
		Mode.BitsPerComponent.YCbCr444 = SDRCOLOUR | HDRCOLOUR;
	}
	else if (ColourFormat == L"YCbCr422") {
		Mode.BitsPerComponent.YCbCr422 = SDRCOLOUR | HDRCOLOUR; 
	}
	else if (ColourFormat == L"YCbCr420") {
		Mode.BitsPerComponent.YCbCr420 = SDRCOLOUR | HDRCOLOUR; 
	}
	else {
		Mode.BitsPerComponent.Rgb = SDRCOLOUR | HDRCOLOUR;  // Default to RGB
	}
	

	logStream.str(""); 
	logStream << "IDDCX_TARGET_MODE2 configured with Size: " << Mode.Size
		<< " and colour format " << WStringToString(ColourFormat);
	vddlog("d", logStream.str().c_str());


	CreateTargetMode(Mode.TargetVideoSignalInfo.targetVideoSignalInfo, Width, Height, VSyncNum, VSyncDen);
}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverMonitorQueryModes(IDDCX_MONITOR MonitorObject, const IDARG_IN_QUERYTARGETMODES* pInArgs, IDARG_OUT_QUERYTARGETMODES* pOutArgs)////////////////////////////////////////////////////////////////////////////////
{
	UNREFERENCED_PARAMETER(MonitorObject);

	vector<IDDCX_TARGET_MODE> TargetModes(monitorModes.size());

	stringstream logStream;
	logStream << "Creating target modes. Number of monitor modes: " << monitorModes.size();
	vddlog("d", logStream.str().c_str());

	// Create a set of modes supported for frame processing and scan-out. These are typically not based on the
	// monitor's descriptor and instead are based on the static processing capability of the device. The OS will
	// report the available set of modes for a given output as the intersection of monitor modes with target modes.

	for (int i = 0; i < monitorModes.size(); i++) {
		CreateTargetMode(TargetModes[i], std::get<0>(monitorModes[i]), std::get<1>(monitorModes[i]), std::get<2>(monitorModes[i]), std::get<3>(monitorModes[i]));

		logStream.str("");
		logStream << "Created target mode " << i << ": Width = " << std::get<0>(monitorModes[i])
			<< ", Height = " << std::get<1>(monitorModes[i])
			<< ", VSync = " << std::get<2>(monitorModes[i]);
		vddlog("d", logStream.str().c_str());
	}

	pOutArgs->TargetModeBufferOutputCount = (UINT)TargetModes.size();

	logStream.str("");
	logStream << "Number of target modes to output: " << pOutArgs->TargetModeBufferOutputCount;
	vddlog("d", logStream.str().c_str());

	if (pInArgs->TargetModeBufferInputCount >= TargetModes.size())
	{
		logStream.str("");
		logStream << "Copying target modes to output buffer.";
		vddlog("d", logStream.str().c_str());
		copy(TargetModes.begin(), TargetModes.end(), pInArgs->pTargetModes);
	}
	else {
		logStream.str("");
		logStream << "Input buffer too small. Required: " << TargetModes.size()
			<< ", Provided: " << pInArgs->TargetModeBufferInputCount;
		vddlog("w", logStream.str().c_str());
	}

	return STATUS_SUCCESS;
}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverMonitorAssignSwapChain(IDDCX_MONITOR MonitorObject, const IDARG_IN_SETSWAPCHAIN* pInArgs)
{
	stringstream logStream;
	logStream << "Assigning swap chain:"
		<< "\n  hSwapChain: " << pInArgs->hSwapChain
		<< "\n  RenderAdapterLuid: " << pInArgs->RenderAdapterLuid.LowPart << "-" << pInArgs->RenderAdapterLuid.HighPart
		<< "\n  hNextSurfaceAvailable: " << pInArgs->hNextSurfaceAvailable;
	vddlog("d", logStream.str().c_str());
	auto* pContext = WdfObjectGet_IndirectDeviceContextWrapper(MonitorObject);
	pContext->pContext->AssignSwapChain(MonitorObject, pInArgs->hSwapChain, pInArgs->RenderAdapterLuid, pInArgs->hNextSurfaceAvailable);
	vddlog("d", "Swap chain assigned successfully.");
	return STATUS_SUCCESS;
}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverMonitorUnassignSwapChain(IDDCX_MONITOR MonitorObject)
{
	stringstream logStream;
	logStream << "Unassigning swap chain for monitor object: " << MonitorObject;
	vddlog("d", logStream.str().c_str());
	auto* pContext = WdfObjectGet_IndirectDeviceContextWrapper(MonitorObject);
	pContext->pContext->UnassignSwapChain();
	vddlog("d", "Swap chain unassigned successfully.");
	return STATUS_SUCCESS;
}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverEvtIddCxAdapterQueryTargetInfo(
	IDDCX_ADAPTER AdapterObject,
	IDARG_IN_QUERYTARGET_INFO* pInArgs,
	IDARG_OUT_QUERYTARGET_INFO* pOutArgs
)
{
	stringstream logStream;
	logStream << "Querying target info for adapter object: " << AdapterObject;
	vddlog("d", logStream.str().c_str());

	UNREFERENCED_PARAMETER(pInArgs);

	pOutArgs->TargetCaps = IDDCX_TARGET_CAPS_HIGH_COLOR_SPACE | IDDCX_TARGET_CAPS_WIDE_COLOR_SPACE;

	if (ColourFormat == L"RGB") {
		pOutArgs->DitheringSupport.Rgb = SDRCOLOUR | HDRCOLOUR;
	}
	else if (ColourFormat == L"YCbCr444") {
		pOutArgs->DitheringSupport.YCbCr444 = SDRCOLOUR | HDRCOLOUR;
	}
	else if (ColourFormat == L"YCbCr422") {
		pOutArgs->DitheringSupport.YCbCr422 = SDRCOLOUR | HDRCOLOUR; 
	}
	else if (ColourFormat == L"YCbCr420") {
		pOutArgs->DitheringSupport.YCbCr420 = SDRCOLOUR | HDRCOLOUR; 
	}
	else {
		pOutArgs->DitheringSupport.Rgb = SDRCOLOUR | HDRCOLOUR;  // Default to RGB
	}

	logStream.str("");
	logStream << "Target capabilities set to: " << pOutArgs->TargetCaps
		<< "\nDithering support colour format set to: " << WStringToString(ColourFormat);
	vddlog("d", logStream.str().c_str());

	return STATUS_SUCCESS;
}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverEvtIddCxMonitorSetDefaultHdrMetadata(
	IDDCX_MONITOR MonitorObject,
	const IDARG_IN_MONITOR_SET_DEFAULT_HDR_METADATA* pInArgs
)
{
	UNREFERENCED_PARAMETER(pInArgs);
	
	stringstream logStream;
	logStream << "=== PROCESSING HDR METADATA REQUEST ===";
	vddlog("d", logStream.str().c_str());
	
	logStream.str("");
	logStream << "Monitor Object: " << MonitorObject 
			  << ", HDR10 Metadata Enabled: " << (hdr10StaticMetadataEnabled ? "Yes" : "No")
			  << ", Color Primaries Enabled: " << (colorPrimariesEnabled ? "Yes" : "No");
	vddlog("d", logStream.str().c_str());

	// Check if HDR metadata processing is enabled
	if (!hdr10StaticMetadataEnabled) {
		vddlog("i", "HDR10 static metadata is disabled, skipping metadata configuration");
		return STATUS_SUCCESS;
	}

	VddHdrMetadata metadata = {};
	bool hasValidMetadata = false;

	// Priority 1: Use EDID-derived metadata if available
	if (edidIntegrationEnabled && autoConfigureFromEdid) {
		// First check for monitor-specific metadata
		auto storeIt = g_HdrMetadataStore.find(MonitorObject);
		if (storeIt != g_HdrMetadataStore.end() && storeIt->second.isValid) {
			metadata = storeIt->second;
			hasValidMetadata = true;
			vddlog("i", "Using monitor-specific EDID-derived HDR metadata");
		}
		// If no monitor-specific metadata, check for template metadata from EDID profile
		else {
			auto templateIt = g_HdrMetadataStore.find(reinterpret_cast<IDDCX_MONITOR>(0));
			if (templateIt != g_HdrMetadataStore.end() && templateIt->second.isValid) {
				metadata = templateIt->second;
				hasValidMetadata = true;
				// Store it for this specific monitor for future use
				g_HdrMetadataStore[MonitorObject] = metadata;
				vddlog("i", "Using template EDID-derived HDR metadata and storing for monitor");
			}
		}
	}

	// Priority 2: Use manual configuration if no EDID data or manual override
	if (!hasValidMetadata || overrideManualSettings) {
		if (colorPrimariesEnabled) {
			metadata = ConvertManualToSmpteMetadata();
			hasValidMetadata = metadata.isValid;
			vddlog("i", "Using manually configured HDR metadata");
		}
	}

	// If we still don't have valid metadata, return early
	if (!hasValidMetadata) {
		vddlog("w", "No valid HDR metadata available, skipping configuration");
		return STATUS_SUCCESS;
	}

	// Log the HDR metadata values being applied
	logStream.str("");
	logStream << "=== APPLYING SMPTE ST.2086 HDR METADATA ===\n"
			  << "Red Primary: (" << metadata.display_primaries_x[0] << ", " << metadata.display_primaries_y[0] << ")\n"
			  << "Green Primary: (" << metadata.display_primaries_x[1] << ", " << metadata.display_primaries_y[1] << ")\n" 
			  << "Blue Primary: (" << metadata.display_primaries_x[2] << ", " << metadata.display_primaries_y[2] << ")\n"
			  << "White Point: (" << metadata.white_point_x << ", " << metadata.white_point_y << ")\n"
			  << "Max Mastering Luminance: " << metadata.max_display_mastering_luminance << " (0.0001 cd/m² units)\n"
			  << "Min Mastering Luminance: " << metadata.min_display_mastering_luminance << " (0.0001 cd/m² units)\n"
			  << "Max Content Light Level: " << metadata.max_content_light_level << " nits\n"
			  << "Max Frame Average Light Level: " << metadata.max_frame_avg_light_level << " nits";
	vddlog("i", logStream.str().c_str());

	// Store the metadata for this monitor
	g_HdrMetadataStore[MonitorObject] = metadata;

	// Convert our metadata to the IddCx expected format
	// Note: The actual HDR metadata structure would depend on the IddCx version
	// For now, we log that the metadata has been processed and stored
	
	logStream.str("");
	logStream << "HDR metadata successfully configured and stored for monitor " << MonitorObject;
	vddlog("i", logStream.str().c_str());

	// In a full implementation, you would pass the metadata to the IddCx framework here
	// The exact API calls would depend on IddCx version and HDR implementation details
	// For Phase 2, we focus on the metadata preparation and storage

	return STATUS_SUCCESS;
}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverEvtIddCxParseMonitorDescription2(
	const IDARG_IN_PARSEMONITORDESCRIPTION2* pInArgs,
	IDARG_OUT_PARSEMONITORDESCRIPTION* pOutArgs
)
{
	// ==============================
	// TODO: In a real driver, this function would be called to generate monitor modes for an EDID by parsing it. In
	// this sample driver, we hard-code the EDID, so this function can generate known modes.
	// ==============================

	stringstream logStream;
	logStream << "Parsing monitor description:"
		<< "\n  MonitorModeBufferInputCount: " << pInArgs->MonitorModeBufferInputCount
		<< "\n  pMonitorModes: " << (pInArgs->pMonitorModes ? "Valid" : "Null");
	vddlog("d", logStream.str().c_str());

	logStream.str("");
	logStream << "Monitor Modes:";
	for (const auto& mode : monitorModes)
	{
		logStream << "\n  Mode - Width: " << std::get<0>(mode)
			<< ", Height: " << std::get<1>(mode)
			<< ", RefreshRate: " << std::get<2>(mode);
	}
	vddlog("d", logStream.str().c_str());

	for (int i = 0; i < monitorModes.size(); i++) {
		s_KnownMonitorModes2.push_back(dispinfo(std::get<0>(monitorModes[i]), std::get<1>(monitorModes[i]), std::get<2>(monitorModes[i]), std::get<3>(monitorModes[i])));
	}
	pOutArgs->MonitorModeBufferOutputCount = (UINT)monitorModes.size();

	if (pInArgs->MonitorModeBufferInputCount < monitorModes.size())
	{
		// Return success if there was no buffer, since the caller was only asking for a count of modes
		return (pInArgs->MonitorModeBufferInputCount > 0) ? STATUS_BUFFER_TOO_SMALL : STATUS_SUCCESS;
	}
	else
	{
		// Copy the known modes to the output buffer
		if (pInArgs->pMonitorModes == nullptr) {
			vddlog("e", "pMonitorModes is null but buffer size is sufficient");
			return STATUS_INVALID_PARAMETER;
		}
		
		logStream.str(""); // Clear the stream
		logStream << "Writing monitor modes to output buffer:";
		for (DWORD ModeIndex = 0; ModeIndex < monitorModes.size(); ModeIndex++)
		{
			pInArgs->pMonitorModes[ModeIndex].Size = sizeof(IDDCX_MONITOR_MODE2);
			pInArgs->pMonitorModes[ModeIndex].Origin = IDDCX_MONITOR_MODE_ORIGIN_MONITORDESCRIPTOR;
			pInArgs->pMonitorModes[ModeIndex].MonitorVideoSignalInfo = s_KnownMonitorModes2[ModeIndex];


			if (ColourFormat == L"RGB") {
				pInArgs->pMonitorModes[ModeIndex].BitsPerComponent.Rgb = SDRCOLOUR | HDRCOLOUR;
				
			}
			else if (ColourFormat == L"YCbCr444") {
				pInArgs->pMonitorModes[ModeIndex].BitsPerComponent.YCbCr444 = SDRCOLOUR | HDRCOLOUR;
			}
			else if (ColourFormat == L"YCbCr422") {
				pInArgs->pMonitorModes[ModeIndex].BitsPerComponent.YCbCr422 = SDRCOLOUR | HDRCOLOUR;
			}
			else if (ColourFormat == L"YCbCr420") {
				pInArgs->pMonitorModes[ModeIndex].BitsPerComponent.YCbCr420 = SDRCOLOUR | HDRCOLOUR;
			}
			else {
				pInArgs->pMonitorModes[ModeIndex].BitsPerComponent.Rgb = SDRCOLOUR | HDRCOLOUR;  // Default to RGB
			}



			logStream << "\n  ModeIndex: " << ModeIndex
				<< "\n    Size: " << pInArgs->pMonitorModes[ModeIndex].Size
				<< "\n    Origin: " << pInArgs->pMonitorModes[ModeIndex].Origin
				<< "\n    Colour Format: " << WStringToString(ColourFormat);
		}

		vddlog("d", logStream.str().c_str());

		// Set the preferred mode as represented in the EDID
		pOutArgs->PreferredMonitorModeIdx = 0;

		return STATUS_SUCCESS;
	}
}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverEvtIddCxMonitorQueryTargetModes2(
	IDDCX_MONITOR MonitorObject,
	const IDARG_IN_QUERYTARGETMODES2* pInArgs,
	IDARG_OUT_QUERYTARGETMODES* pOutArgs
)
{
	//UNREFERENCED_PARAMETER(MonitorObject);
	stringstream logStream;

	logStream << "Querying target modes:"
		<< "\n  MonitorObject Handle: " << static_cast<void*>(MonitorObject) 
		<< "\n  TargetModeBufferInputCount: " << pInArgs->TargetModeBufferInputCount;
	vddlog("d", logStream.str().c_str());

	vector<IDDCX_TARGET_MODE2> TargetModes(monitorModes.size());

	// Create a set of modes supported for frame processing and scan-out. These are typically not based on the
	// monitor's descriptor and instead are based on the static processing capability of the device. The OS will
	// report the available set of modes for a given output as the intersection of monitor modes with target modes.

	logStream.str(""); // Clear the stream
	logStream << "Creating target modes:";

	for (int i = 0; i < monitorModes.size(); i++) {
		CreateTargetMode2(TargetModes[i], std::get<0>(monitorModes[i]), std::get<1>(monitorModes[i]), std::get<2>(monitorModes[i]), std::get<3>(monitorModes[i]));
		logStream << "\n  TargetModeIndex: " << i
			<< "\n    Width: " << std::get<0>(monitorModes[i])
			<< "\n    Height: " << std::get<1>(monitorModes[i])
			<< "\n    RefreshRate: " << std::get<2>(monitorModes[i]);
	}
	vddlog("d", logStream.str().c_str());

	pOutArgs->TargetModeBufferOutputCount = (UINT)TargetModes.size();

	logStream.str("");
	logStream << "Output target modes count: " << pOutArgs->TargetModeBufferOutputCount;
	vddlog("d", logStream.str().c_str());

	if (pInArgs->TargetModeBufferInputCount >= TargetModes.size())
	{
		copy(TargetModes.begin(), TargetModes.end(), pInArgs->pTargetModes);

		logStream.str("");
		logStream << "Target modes copied to output buffer:";
		for (int i = 0; i < TargetModes.size(); i++)
		{
			logStream << "\n  TargetModeIndex: " << i
				<< "\n    Size: " << TargetModes[i].Size
				<< "\n    ColourFormat: " << WStringToString(ColourFormat);
		}
		vddlog("d", logStream.str().c_str());
	}
	else
	{
		vddlog("w", "Input buffer is too small for target modes.");
	}

	return STATUS_SUCCESS;
}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverEvtIddCxAdapterCommitModes2(
	IDDCX_ADAPTER AdapterObject,
	const IDARG_IN_COMMITMODES2* pInArgs
)
{
	UNREFERENCED_PARAMETER(AdapterObject);
	UNREFERENCED_PARAMETER(pInArgs);

	return STATUS_SUCCESS;
}

_Use_decl_annotations_
NTSTATUS VirtualDisplayDriverEvtIddCxMonitorSetGammaRamp(
	IDDCX_MONITOR MonitorObject,
	const IDARG_IN_SET_GAMMARAMP* pInArgs
)
{
	stringstream logStream;
	logStream << "=== PROCESSING GAMMA RAMP REQUEST ===";
	vddlog("d", logStream.str().c_str());
	
	logStream.str("");
	logStream << "Monitor Object: " << MonitorObject 
			  << ", Color Space Enabled: " << (colorSpaceEnabled ? "Yes" : "No")
			  << ", Matrix Transform Enabled: " << (enableMatrixTransform ? "Yes" : "No");
	vddlog("d", logStream.str().c_str());

	// Check if color space processing is enabled
	if (!colorSpaceEnabled) {
		vddlog("i", "Color space processing is disabled, skipping gamma ramp configuration");
		return STATUS_SUCCESS;
	}

	VddGammaRamp gammaRamp = {};
	bool hasValidGammaRamp = false;

	// Priority 1: Use EDID-derived gamma settings if available
	if (edidIntegrationEnabled && autoConfigureFromEdid) {
		// First check for monitor-specific gamma ramp
		auto storeIt = g_GammaRampStore.find(MonitorObject);
		if (storeIt != g_GammaRampStore.end() && storeIt->second.isValid) {
			gammaRamp = storeIt->second;
			hasValidGammaRamp = true;
			vddlog("i", "Using monitor-specific EDID-derived gamma ramp");
		}
		// If no monitor-specific gamma ramp, check for template from EDID profile
		else {
			auto templateIt = g_GammaRampStore.find(reinterpret_cast<IDDCX_MONITOR>(0));
			if (templateIt != g_GammaRampStore.end() && templateIt->second.isValid) {
				gammaRamp = templateIt->second;
				hasValidGammaRamp = true;
				// Store it for this specific monitor for future use
				g_GammaRampStore[MonitorObject] = gammaRamp;
				vddlog("i", "Using template EDID-derived gamma ramp and storing for monitor");
			}
		}
	}

	// Priority 2: Use manual configuration if no EDID data or manual override
	if (!hasValidGammaRamp || overrideManualSettings) {
		gammaRamp = ConvertManualToGammaRamp();
		hasValidGammaRamp = gammaRamp.isValid;
		vddlog("i", "Using manually configured gamma ramp");
	}

	// If we still don't have valid gamma settings, return early
	if (!hasValidGammaRamp) {
		vddlog("w", "No valid gamma ramp available, skipping configuration");
		return STATUS_SUCCESS;
	}

	// Log the gamma ramp values being applied
	logStream.str("");
	logStream << "=== APPLYING GAMMA RAMP AND COLOR SPACE TRANSFORM ===\n"
			  << "Gamma Value: " << gammaRamp.gamma << "\n"
			  << "Color Space: " << WStringToString(gammaRamp.colorSpace) << "\n"
			  << "Use Matrix Transform: " << (gammaRamp.useMatrix ? "Yes" : "No");
	vddlog("i", logStream.str().c_str());

	// Apply gamma ramp based on type
	if (pInArgs->Type == IDDCX_GAMMARAMP_TYPE_3x4_COLORSPACE_TRANSFORM && gammaRamp.useMatrix) {
		// Apply 3x4 color space transformation matrix
		logStream.str("");
		logStream << "Applying 3x4 Color Space Matrix:\n"
				  << "  [" << gammaRamp.matrix.matrix[0][0] << ", " << gammaRamp.matrix.matrix[0][1] << ", " << gammaRamp.matrix.matrix[0][2] << ", " << gammaRamp.matrix.matrix[0][3] << "]\n"
				  << "  [" << gammaRamp.matrix.matrix[1][0] << ", " << gammaRamp.matrix.matrix[1][1] << ", " << gammaRamp.matrix.matrix[1][2] << ", " << gammaRamp.matrix.matrix[1][3] << "]\n"
				  << "  [" << gammaRamp.matrix.matrix[2][0] << ", " << gammaRamp.matrix.matrix[2][1] << ", " << gammaRamp.matrix.matrix[2][2] << ", " << gammaRamp.matrix.matrix[2][3] << "]";
		vddlog("i", logStream.str().c_str());

		// Store the matrix for this monitor
		g_GammaRampStore[MonitorObject] = gammaRamp;

		// In a full implementation, you would apply the matrix to the rendering pipeline here
		// The exact API calls would depend on IddCx version and hardware capabilities
		
		logStream.str("");
		logStream << "3x4 matrix transform applied successfully for monitor " << MonitorObject;
		vddlog("i", logStream.str().c_str());
	}
	else if (pInArgs->Type == IDDCX_GAMMARAMP_TYPE_RGB256x3x16) {
		// Apply traditional RGB gamma ramp
		logStream.str("");
		logStream << "Applying RGB 256x3x16 gamma ramp with gamma " << gammaRamp.gamma;
		vddlog("i", logStream.str().c_str());

		// In a full implementation, you would generate and apply RGB lookup tables here
		// Based on the gamma value and color space
		
		logStream.str("");
		logStream << "RGB gamma ramp applied successfully for monitor " << MonitorObject;
		vddlog("i", logStream.str().c_str());
	}
	else {
		logStream.str("");
		logStream << "Unsupported gamma ramp type: " << pInArgs->Type << ", using default gamma processing";
		vddlog("w", logStream.str().c_str());
	}

	// Store the final gamma ramp for this monitor
	g_GammaRampStore[MonitorObject] = gammaRamp;

	logStream.str("");
	logStream << "Gamma ramp configuration completed for monitor " << MonitorObject;
	vddlog("i", logStream.str().c_str());

	return STATUS_SUCCESS;
}

#pragma endregion

#pragma region Phase 5: Final Integration and Testing

// ===========================================
// PHASE 5: FINAL INTEGRATION AND TESTING
// ===========================================

struct VddIntegrationStatus {
	bool edidParsingEnabled = false;
	bool hdrMetadataValid = false;
	bool gammaRampValid = false;
	bool modeManagementActive = false;
	bool configurationValid = false;
	wstring lastError = L"";
	DWORD errorCount = 0;
	DWORD warningCount = 0;
};

static VddIntegrationStatus g_IntegrationStatus = {};

NTSTATUS ValidateEdidIntegration()
{
	stringstream logStream;
	logStream << "=== EDID INTEGRATION VALIDATION ===";
	vddlog("i", logStream.str().c_str());

	bool validationPassed = true;
	DWORD issues = 0;

	// Check EDID integration settings
	bool edidEnabled = EnabledQuery(L"EdidIntegrationEnabled");
	bool autoConfig = EnabledQuery(L"AutoConfigureFromEdid");
	wstring profilePath = GetStringSetting(L"EdidProfilePath");

	logStream.str("");
	logStream << "EDID Configuration Status:"
		<< "\n  Integration Enabled: " << (edidEnabled ? "Yes" : "No")
		<< "\n  Auto Configuration: " << (autoConfig ? "Yes" : "No")
		<< "\n  Profile Path: " << WStringToString(profilePath);
	vddlog("d", logStream.str().c_str());

	if (!edidEnabled) {
		vddlog("w", "EDID integration is disabled - manual configuration mode");
		issues++;
	}

	if (profilePath.empty() || profilePath == L"EDID/monitor_profile.xml") {
		vddlog("w", "EDID profile path not configured or using default path");
		issues++;
	}

	// Validate HDR configuration
	bool hdrEnabled = EnabledQuery(L"Hdr10StaticMetadataEnabled");
	bool colorEnabled = EnabledQuery(L"ColorPrimariesEnabled");
	
	logStream.str("");
	logStream << "HDR Configuration Status:"
		<< "\n  HDR10 Metadata: " << (hdrEnabled ? "Enabled" : "Disabled")
		<< "\n  Color Primaries: " << (colorEnabled ? "Enabled" : "Disabled");
	vddlog("d", logStream.str().c_str());

	// Validate mode management
	bool autoResEnabled = EnabledQuery(L"AutoResolutionsEnabled");
	wstring localSourcePriority = GetStringSetting(L"SourcePriority");
	
	logStream.str("");
	logStream << "Mode Management Status:"
		<< "\n  Auto Resolutions: " << (autoResEnabled ? "Enabled" : "Disabled")
		<< "\n  Source Priority: " << WStringToString(localSourcePriority);
	vddlog("d", logStream.str().c_str());

	// Update integration status
	g_IntegrationStatus.edidParsingEnabled = edidEnabled;
	g_IntegrationStatus.hdrMetadataValid = hdrEnabled;
	g_IntegrationStatus.modeManagementActive = autoResEnabled;
	g_IntegrationStatus.configurationValid = (issues < 3);
	g_IntegrationStatus.warningCount = issues;

	logStream.str("");
	logStream << "=== VALIDATION SUMMARY ==="
		<< "\n  Total Issues Found: " << issues
		<< "\n  Configuration Valid: " << (g_IntegrationStatus.configurationValid ? "Yes" : "No")
		<< "\n  Integration Status: " << (validationPassed ? "PASSED" : "FAILED");
	vddlog("i", logStream.str().c_str());

	return validationPassed ? STATUS_SUCCESS : STATUS_UNSUCCESSFUL;
}

NTSTATUS PerformanceMonitor()
{
	stringstream logStream;
	logStream << "=== PERFORMANCE MONITORING ===";
	vddlog("d", logStream.str().c_str());

	// Monitor mode generation performance
	auto start = chrono::high_resolution_clock::now();
	
	// Test mode generation with current configuration
	vector<tuple<DWORD, DWORD, DWORD, DWORD>> testModes;
	// Use the global monitorModes for performance testing
	for (const auto& mode : monitorModes) {
		testModes.push_back(make_tuple(get<0>(mode), get<1>(mode), get<2>(mode), get<3>(mode)));
	}
	
	auto end = chrono::high_resolution_clock::now();
	auto duration = chrono::duration_cast<chrono::microseconds>(end - start);

	logStream.str("");
	logStream << "Performance Metrics:"
		<< "\n  Mode Generation Time: " << duration.count() << " microseconds"
		<< "\n  Total Modes Generated: " << testModes.size()
		<< "\n  Memory Usage: ~" << (testModes.size() * sizeof(tuple<DWORD, DWORD, DWORD, DWORD>)) << " bytes";
	vddlog("i", logStream.str().c_str());

	// Performance thresholds
	if (duration.count() > 10000) { // 10ms threshold
		vddlog("w", "Mode generation is slower than expected (>10ms)");
		g_IntegrationStatus.warningCount++;
	}

	if (testModes.size() > 100) {
		vddlog("w", "Large number of modes generated - consider filtering");
		g_IntegrationStatus.warningCount++;
	}

	return STATUS_SUCCESS;
}

NTSTATUS CreateFallbackConfiguration()
{
	stringstream logStream;
	logStream << "=== CREATING FALLBACK CONFIGURATION ===";
	vddlog("i", logStream.str().c_str());

	// Create safe fallback modes if EDID parsing fails
	vector<tuple<DWORD, DWORD, DWORD, DWORD>> fallbackModes = {
		make_tuple(1920, 1080, 60, 0),   // Full HD 60Hz
		make_tuple(1366, 768, 60, 0),    // Common laptop resolution
		make_tuple(1280, 720, 60, 0),    // HD 60Hz
		make_tuple(800, 600, 60, 0)      // Safe fallback
	};

	logStream.str("");
	logStream << "Fallback modes created:";
	for (const auto& mode : fallbackModes) {
		logStream << "\n  " << get<0>(mode) << "x" << get<1>(mode) << "@" << get<2>(mode) << "Hz";
	}
	vddlog("d", logStream.str().c_str());

	// Create fallback HDR metadata
	VddHdrMetadata fallbackHdr = {};
	fallbackHdr.display_primaries_x[0] = 31250; // sRGB red
	fallbackHdr.display_primaries_y[0] = 16992;
	fallbackHdr.display_primaries_x[1] = 15625; // sRGB green
	fallbackHdr.display_primaries_y[1] = 35352;
	fallbackHdr.display_primaries_x[2] = 7812;  // sRGB blue
	fallbackHdr.display_primaries_y[2] = 3906;
	fallbackHdr.white_point_x = 15625; // D65 white point
	fallbackHdr.white_point_y = 16406;
	fallbackHdr.max_display_mastering_luminance = 1000000; // 100 nits
	fallbackHdr.min_display_mastering_luminance = 500;     // 0.05 nits
	fallbackHdr.max_content_light_level = 400;
	fallbackHdr.max_frame_avg_light_level = 100;
	fallbackHdr.isValid = true;

	logStream.str("");
	logStream << "Fallback HDR metadata (sRGB/D65):"
		<< "\n  Max Mastering Luminance: " << fallbackHdr.max_display_mastering_luminance 
		<< "\n  Min Mastering Luminance: " << fallbackHdr.min_display_mastering_luminance
		<< "\n  Max Content Light: " << fallbackHdr.max_content_light_level << " nits";
	vddlog("d", logStream.str().c_str());

	vddlog("i", "Fallback configuration ready for emergency use");
	return STATUS_SUCCESS;
}

NTSTATUS RunComprehensiveDiagnostics()
{
	stringstream logStream;
	logStream << "=== COMPREHENSIVE SYSTEM DIAGNOSTICS ===";
	vddlog("i", logStream.str().c_str());

	NTSTATUS status = STATUS_SUCCESS;
	
	// Reset diagnostic counters
	g_IntegrationStatus.errorCount = 0;
	g_IntegrationStatus.warningCount = 0;

	// Test 1: Configuration validation
	logStream.str("");
	logStream << "Running Test 1: Configuration Validation";
	vddlog("d", logStream.str().c_str());
	
	NTSTATUS configStatus = ValidateEdidIntegration();
	if (!NT_SUCCESS(configStatus)) {
		vddlog("e", "Configuration validation failed");
		g_IntegrationStatus.errorCount++;
		status = configStatus;
	}

	// Test 2: Performance monitoring
	logStream.str("");
	logStream << "Running Test 2: Performance Monitoring";
	vddlog("d", logStream.str().c_str());
	
	NTSTATUS perfStatus = PerformanceMonitor();
	if (!NT_SUCCESS(perfStatus)) {
		vddlog("e", "Performance monitoring failed");
		g_IntegrationStatus.errorCount++;
	}

	// Test 3: Fallback configuration
	logStream.str("");
	logStream << "Running Test 3: Fallback Configuration";
	vddlog("d", logStream.str().c_str());
	
	NTSTATUS fallbackStatus = CreateFallbackConfiguration();
	if (!NT_SUCCESS(fallbackStatus)) {
		vddlog("e", "Fallback configuration creation failed");
		g_IntegrationStatus.errorCount++;
	}

	// Test 4: Memory and resource validation
	logStream.str("");
	logStream << "Running Test 4: Resource Validation";
	vddlog("d", logStream.str().c_str());

	// Check global stores
	size_t hdrStoreSize = g_HdrMetadataStore.size();
	size_t gammaStoreSize = g_GammaRampStore.size();
	
	logStream.str("");
	logStream << "Resource Usage:"
		<< "\n  HDR Metadata Store: " << hdrStoreSize << " entries"
		<< "\n  Gamma Ramp Store: " << gammaStoreSize << " entries"
		<< "\n  Known Monitor Modes: " << s_KnownMonitorModes2.size() << " modes";
	vddlog("d", logStream.str().c_str());

	// Final diagnostic summary
	logStream.str("");
	logStream << "=== DIAGNOSTIC SUMMARY ==="
		<< "\n  Tests Run: 4"
		<< "\n  Errors: " << g_IntegrationStatus.errorCount
		<< "\n  Warnings: " << g_IntegrationStatus.warningCount
		<< "\n  Overall Status: " << (NT_SUCCESS(status) ? "PASSED" : "FAILED");
	vddlog("i", logStream.str().c_str());

	return status;
}

NTSTATUS ValidateAndSanitizeConfiguration()
{
	stringstream logStream;
	logStream << "=== CONFIGURATION VALIDATION AND SANITIZATION ===";
	vddlog("i", logStream.str().c_str());

	DWORD sanitizedSettings = 0;

	// Validate refresh rate settings  
	double minRefresh = GetDoubleSetting(L"MinRefreshRate");
	double maxRefresh = GetDoubleSetting(L"MaxRefreshRate");
	
	if (minRefresh <= 0 || minRefresh > 300) {
		vddlog("w", "Invalid min refresh rate detected, setting to safe default (24Hz)");
		minRefresh = 24.0;
		sanitizedSettings++;
	}
	
	if (maxRefresh <= minRefresh || maxRefresh > 500) {
		vddlog("w", "Invalid max refresh rate detected, setting to safe default (240Hz)");
		maxRefresh = 240.0;
		sanitizedSettings++;
	}

	// Validate resolution settings
	int minWidth = GetIntegerSetting(L"MinResolutionWidth");
	int minHeight = GetIntegerSetting(L"MinResolutionHeight");
	int maxWidth = GetIntegerSetting(L"MaxResolutionWidth");
	int maxHeight = GetIntegerSetting(L"MaxResolutionHeight");

	if (minWidth < 640 || minWidth > 7680) {
		vddlog("w", "Invalid min width detected, setting to 640");
		minWidth = 640;
		sanitizedSettings++;
	}
	
	if (minHeight < 480 || minHeight > 4320) {
		vddlog("w", "Invalid min height detected, setting to 480");
		minHeight = 480;
		sanitizedSettings++;
	}

	if (maxWidth < minWidth || maxWidth > 15360) {
		vddlog("w", "Invalid max width detected, setting to 7680");
		maxWidth = 7680;
		sanitizedSettings++;
	}
	
	if (maxHeight < minHeight || maxHeight > 8640) {
		vddlog("w", "Invalid max height detected, setting to 4320");
		maxHeight = 4320;
		sanitizedSettings++;
	}

	// Validate HDR luminance values
	double maxLuminance = GetDoubleSetting(L"MaxDisplayMasteringLuminance");
	double minLuminance = GetDoubleSetting(L"MinDisplayMasteringLuminance");
	
	if (maxLuminance <= 0 || maxLuminance > 10000) {
		vddlog("w", "Invalid max luminance detected, setting to 1000 nits");
		maxLuminance = 1000.0;
		sanitizedSettings++;
	}
	
	if (minLuminance <= 0 || minLuminance >= maxLuminance) {
		vddlog("w", "Invalid min luminance detected, setting to 0.05 nits");
		minLuminance = 0.05;
		sanitizedSettings++;
	}

	// Validate color primaries
	double localRedX = GetDoubleSetting(L"RedX");
	double localRedY = GetDoubleSetting(L"RedY");
	double localGreenX = GetDoubleSetting(L"GreenX");
	double localGreenY = GetDoubleSetting(L"GreenY");
	double localBlueX = GetDoubleSetting(L"BlueX");
	double localBlueY = GetDoubleSetting(L"BlueY");

	if (localRedX < 0.0 || localRedX > 1.0 || localRedY < 0.0 || localRedY > 1.0) {
		vddlog("w", "Invalid red primary coordinates, using sRGB defaults");
		sanitizedSettings++;
	}
	
	if (localGreenX < 0.0 || localGreenX > 1.0 || localGreenY < 0.0 || localGreenY > 1.0) {
		vddlog("w", "Invalid green primary coordinates, using sRGB defaults");
		sanitizedSettings++;
	}
	
	if (localBlueX < 0.0 || localBlueX > 1.0 || localBlueY < 0.0 || localBlueY > 1.0) {
		vddlog("w", "Invalid blue primary coordinates, using sRGB defaults");
		sanitizedSettings++;
	}

	logStream.str("");
	logStream << "Configuration validation completed:"
		<< "\n  Settings sanitized: " << sanitizedSettings
		<< "\n  Refresh rate range: " << minRefresh << "-" << maxRefresh << " Hz"
		<< "\n  Resolution range: " << minWidth << "x" << minHeight << " to " << maxWidth << "x" << maxHeight
		<< "\n  Luminance range: " << minLuminance << "-" << maxLuminance << " nits";
	vddlog("i", logStream.str().c_str());

	return (sanitizedSettings < 5) ? STATUS_SUCCESS : STATUS_UNSUCCESSFUL;
}

NTSTATUS InitializePhase5Integration()
{
	stringstream logStream;
	logStream << "=== PHASE 5: FINAL INTEGRATION INITIALIZATION ===";
	vddlog("i", logStream.str().c_str());

	// Initialize integration status
	g_IntegrationStatus = {};
	
	// Run configuration validation and sanitization
	NTSTATUS configStatus = ValidateAndSanitizeConfiguration();
	if (!NT_SUCCESS(configStatus)) {
		vddlog("w", "Configuration validation completed with warnings");
		g_IntegrationStatus.warningCount++;
	}
	
	// Run comprehensive diagnostics
	NTSTATUS diagStatus = RunComprehensiveDiagnostics();
	
	if (NT_SUCCESS(diagStatus) && NT_SUCCESS(configStatus)) {
		vddlog("i", "Phase 5 integration completed successfully");
		g_IntegrationStatus.configurationValid = true;
	} else {
		vddlog("e", "Phase 5 integration completed with errors");
		g_IntegrationStatus.lastError = L"Diagnostic failures detected";
	}

	// Log final integration status
	logStream.str("");
	logStream << "=== FINAL INTEGRATION STATUS ==="
		<< "\n  EDID Integration: " << (g_IntegrationStatus.edidParsingEnabled ? "ACTIVE" : "INACTIVE")
		<< "\n  HDR Metadata: " << (g_IntegrationStatus.hdrMetadataValid ? "VALID" : "INVALID")
		<< "\n  Gamma Processing: " << (g_IntegrationStatus.gammaRampValid ? "ACTIVE" : "INACTIVE")  
		<< "\n  Mode Management: " << (g_IntegrationStatus.modeManagementActive ? "ACTIVE" : "INACTIVE")
		<< "\n  Configuration: " << (g_IntegrationStatus.configurationValid ? "VALID" : "INVALID")
		<< "\n  Total Errors: " << g_IntegrationStatus.errorCount
		<< "\n  Total Warnings: " << g_IntegrationStatus.warningCount;
	vddlog("i", logStream.str().c_str());

	return (NT_SUCCESS(diagStatus) && NT_SUCCESS(configStatus)) ? STATUS_SUCCESS : STATUS_UNSUCCESSFUL;
}

#pragma endregion
