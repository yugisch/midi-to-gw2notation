from selenium import webdriver
from selenium.webdriver.common.by import By

driver = webdriver.Chrome()

try:
    driver.get("http://localhost:8080")

    # Find the MIDI upload element
    midi_input = driver.find_element(By.ID, "midiFile")

    # Find the Convert button
    convert_button = driver.find_element(By.ID, "convertButton")

    print("MIDI input found:", midi_input.tag_name)
    print("Convert button found:", convert_button.text)

    print("TEST PASSED: Both elements were found!")

finally:
    driver.quit()

# Element	        HTML ID	        Type
# MIDI upload	    midiFile	    File input
# Convert button	convertButton	Button
# Key optimization	transposeMode	Dropdown
# Beat grid	        beatGrid	    Dropdown
# Status message	status	        Div