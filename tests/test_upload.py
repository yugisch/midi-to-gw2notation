
from selenium import webdriver
from selenium.webdriver.common.by import By
import os
import time

# 1. Define the MIDI file path
midi_file = r"C:\Users\skull\Downloads\HappyBirthday.mid"

# 2. Check that the file exists
assert os.path.exists(midi_file), "MIDI file does not exist!"

start_time = time.time()

driver = webdriver.Chrome()

try:
    # 3. Open our MIDI converter
    driver.get("http://localhost:8080")

    # 4. Find the MIDI upload input
    upload_input = driver.find_element(By.ID, "midiFile")

    # 5. Upload the MIDI file
    upload_input.send_keys(midi_file)

    # 6. Verify the selected file
    uploaded_file = upload_input.get_attribute("value")

    assert uploaded_file.endswith("HappyBirthday.mid"), \
        "MIDI file was not selected correctly!"

    print("Selected file:", uploaded_file)
    print("TEST PASSED: MIDI file uploaded successfully!")

finally:
    driver.quit()

end_time = time.time()

print(f"Total execution time: {end_time - start_time:.2f} seconds")