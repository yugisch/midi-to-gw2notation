
# Import Selenium tools
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

# Import os to check whether our MIDI file exists
import os


# STEP 1: Define the MIDI file location
midi_file = r"C:\Users\skull\Downloads\HappyBirthday.mid"

# Make sure the test file exists before starting
assert os.path.exists(midi_file), "MIDI file does not exist!"


# STEP 2: Launch Chrome
driver = webdriver.Chrome()

try:
    # Open our locally hosted MIDI converter
    driver.get("http://localhost:8080")

    # Create a wait object with a maximum wait time of 15 seconds
    wait = WebDriverWait(driver, 15)


    # STEP 3: Find the MIDI upload input
    upload_input = driver.find_element(By.ID, "midiFile")

    # Select our MIDI file
    upload_input.send_keys(midi_file)


    # STEP 4: Find the Convert button
    convert_button = driver.find_element(By.ID, "convertButton")

    # Click Convert to start processing the MIDI file
    convert_button.click()


    # STEP 5: Wait until the conversion creates a track
    # The application displays converted tracks inside #channels
    wait.until(
        EC.presence_of_element_located(
            (By.CSS_SELECTOR, "#channels .channel")
        )
    )


    # STEP 6: Find the conversion status message
    status = driver.find_element(By.ID, "status").text

    # Find the generated notation
    notation = driver.find_element(
        By.CSS_SELECTOR, "#channels .notation"
    ).text

    # STEP 7: Verify the conversion result
    assert "notes" in status.lower(), \
        "Conversion status does not show a note count!"

    assert notation.strip() != "", \
        "No notation was generated!"

    # Display the results
    print("Conversion status:", status)
    print("Generated notation:", notation[:150])
    print("TEST PASSED: MIDI conversion successful!")


finally:
    # Always close Chrome, even if the test fails
    driver.quit()
