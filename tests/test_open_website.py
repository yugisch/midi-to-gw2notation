from selenium import webdriver

# 1. Launch Chrome
driver = webdriver.Chrome()

try:
    # 2. Open our MIDI converter
    driver.get("http://localhost:8080")

    # 3. Get the webpage title
    page_title = driver.title

    # 4. Print the result
    print("Page title:", page_title)

    # 5. Basic verification
    assert page_title != "", "Website title is empty!"

    print("TEST PASSED: Website opened successfully!")

finally:
    # 6. Close Chrome
    driver.quit()


# webdriver.Chrome()	Launches Chrome
# driver.get()	        Opens a URL
# driver.title	        Reads the webpage title
# assert	            Checks whether a condition is true
# driver.quit()	        Closes the browser session