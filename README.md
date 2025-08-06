# 🛠️ Virtual Display Driver Development Team

| 👤 Developer          | 🏷️ Role                            | 💖 Support Us                                                                                                         |
| --------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **[MikeTheTech](https://github.com/itsmikethetech)** | Project Manager, Lead Programmer | [Patreon](https://www.patreon.com/mikethetech) :gem: / [GitHub Sponsors](https://github.com/sponsors/itsmikethetech/) 💖  |
| **[Jocke](https://github.com/zjoasan)**       | Programmer, Concept Design  | [GitHub Sponsors ](https://github.com/sponsors/zjoasan) 💖                                                             |

:bulb: *We appreciate your support—every contribution helps us keep building amazing experiences!*

# <img src="https://github.com/user-attachments/assets/22ff37ba-a8ea-4b65-b7b2-e7fcb09d858b" height="32" width="32"></img> Virtual Display Driver
This project creates a _virtual monitor_ in Windows that functions just like a physical display. It is particularly useful for applications such as **streaming, virtual reality, screen recording,** and **headless servers—systems** that operate without a physical display attached. 

Unlike traditional monitors, this virtual display supports custom resolutions and refresh rates beyond hardware limitations—offering greater flexibility for advanced setups. You can also use custom EDIDs to simulate or emulate existing hardware displays.

## ⬇️ Download Latest Version

- [Driver Installer (Windows 10/11)](https://github.com/VirtualDrivers/Virtual-Display-Driver/releases) - Check the [Releases](https://github.com/VirtualDrivers/Virtual-Display-Driver/releases) page for the latest version and release notes.

> [!IMPORTANT]
> Before using the Virtual Display Driver, ensure the following dependencies are installed:
> - **Microsoft Visual C++ Redistributable**  
>   If you encounter the error `vcruntime140.dll not found`, download and install the latest version from the [Microsoft Visual C++ Redistributable page](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist?view=msvc-170).


## 🛠️ Installation

- Step 1: Download the Virtual Driver Control app.
   - You can download the installer directly from the [Releases](https://github.com/VirtualDrivers/Virtual-Display-Driver/releases) page.

- Step 2: Extract to a folder and run the app
   - Launch the VDC.
   - Click the Install button.

- Step 3: Verify the Installation (Optional)
   - Check if the Virtual Display Driver is correctly installed by running the following:
   - **Device Manager:** Check "Device Manager" under "Display Adapters."
   - **Settings:** Check display settings under system settings and see if the virtual displays show.

Manual installation can be found in the wiki

## 🤔 Comparison with other IDDs

The table below shows a comparison with other popular Indirect Display Driver
projects.

![Untitled-6](https://github.com/user-attachments/assets/98ccb915-5a94-42f9-818b-213ceef4c3ac)

¹ ARM64 Support in Windows 11 24H2 or later may require test signing be enabled.

HDR Support Now Available for Windows 11 23H2+ 

## ▶️ Videos and Tutorials

### Installation Video

[![Thumbnail24 (1)](https://github.com/user-attachments/assets/383d840c-8327-439b-a89b-84b271320371)](https://youtu.be/jN5YnHlC0fE)

![Powerpoint](https://github.com/user-attachments/assets/9ac05776-36e1-4ba1-ac52-3f189dbd7730)

## 🤝 Sponsors

<table>
  <tr>
    <td><img src="https://github.com/user-attachments/assets/ca93d971-67dc-41dd-b945-ab4f372ea72a" /></td>
    <td>Free code signing on Windows provided by <a href="https://signpath.io">SignPath.io</a>, certificate by <a href="https://signpath.org">SignPath Foundation</a></td>
  </tr>
</table>

<table>
  <tr>
    <td>Advanced 32bit IEEE Float Audio brought to you by **Lune Studios**.</td>
  </tr>
</table>

## Acknowledgements

- Shoutout to **[MikeTheTech](https://github.com/itsmikethetech)** Project Manager, Owner, and Programmer
- Shoutout to **[zjoasan](https://github.com/zjoasan)** Programmer. For scripts, EDID integration, and parts of installer.
- Shoutout to **[Bud](https://github.com/bud3699)** Former Lead Programmer, has since left the project.
- Shoutout to **[Roshkins](https://github.com/roshkins/IddSampleDriver)** for the original repo.
- Shoutout to **[Baloukj](https://github.com/baloukj/IddSampleDriver)** for the 8-bit / 10-bit support. (Also, first to push the new Microsoft Driver public!)
- Shoutout to **[Anakngtokwa](https://github.com/Anakngtokwa)** for assisting with finding driver sources.
- **[Microsoft](https://github.com/microsoft/Windows-driver-samples/tree/master/video/IndirectDisplay)** Indirect Display Driver/Sample (Driver code)
- Thanks to **[AKATrevorJay](https://github.com/akatrevorjay/edid-generator)** for the hi-res EDID.
- Shoutout to **[LexTrack](https://github.com/lextrack/)** for the MiniScreenRecorder script. 

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=VirtualDrivers/Virtual-Display-Driver&type=Date)](https://www.star-history.com/#VirtualDrivers/Virtual-Display-Driver&Date)

## Disclaimer:

This software is provided "AS IS" with NO IMPLICIT OR EXPLICIT warranty. It's worth noting that while this software functioned without issues on our systems, there is no guarantee that it will not impact your computer. It operates in User Mode(Session0), which reduces the likelihood of causing system instability, such as the Blue Screen of Death. However, exercise caution when using this software.
